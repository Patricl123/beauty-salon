import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  migrationFiles,
  TEST_ADMIN_ID,
  TEST_USER_ID,
} from "../../test-support/database";
import type {
  AppData,
  Appointment,
  CatalogImpact,
  CatalogKind,
} from "../types";
import { addDays, today } from "./schedule";

let db: PGlite;
async function role(name = "authenticated", user = TEST_ADMIN_ID) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${name}`);
}
async function call<T>(name: string, args: unknown[] = []): Promise<T> {
  return (
    await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
}
async function fails(name: string, args: unknown[], message: RegExp) {
  await db.exec("savepoint expected_error");
  try {
    await expect(call(name, args)).rejects.toThrow(message);
  } finally {
    await db.exec("rollback to savepoint expected_error");
  }
}
const payload = () => ({
  serviceId: "haircut",
  masterId: "aida",
  date: addDays(today(), 2),
  time: "10:00",
  clientName: "Тест архива",
  phone: "+996000000009",
  comment: "",
  expectedPrice: 2200,
  expectedDuration: 60,
  consent: true,
});
const book = () =>
  call<Appointment>("create_appointment", [
    crypto.randomUUID(),
    "e".repeat(64),
    payload(),
  ]);
const impact = (kind: CatalogKind) =>
  call<CatalogImpact>("admin_catalog_impact", [
    kind,
    kind === "master" ? "aida" : "haircut",
  ]);
async function action(kind: CatalogKind, verb: string) {
  const state = await impact(kind);
  return call<AppData>("admin_catalog_action", [
    kind,
    kind === "master" ? "aida" : "haircut",
    verb,
    state.revision,
  ]);
}
beforeAll(async () => {
  db = await createTestDatabase();
}, 60000);
beforeEach(async () => {
  await db.exec("begin");
  await role();
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

describe.each(["master", "service"] as const)("%s lifecycle", (kind) => {
  const id = kind === "master" ? "aida" : "haircut";
  it("deletes only unused objects and safely removes bindings/blocks", async () => {
    await db.exec("reset role");
    await db.exec(
      "insert into public.time_blocks values('archive-test','aida',now()+interval '1 day',now()+interval '1 day 1 hour','test')",
    );
    await role();
    const result = await action(kind, "delete");
    expect(
      (kind === "master" ? result.masters : result.services).some(
        (x) => x.id === id,
      ),
    ).toBe(false);
    expect(result.appointments).toEqual([]);
    if (kind === "master") expect(result.blocks).toEqual([]);
    else
      expect(result.masters.every((m) => !m.serviceIds.includes(id))).toBe(
        true,
      );
    await fails(
      "create_appointment",
      [crypto.randomUUID(), "f".repeat(64), payload()],
      /SERVICE_UNAVAILABLE|SLOT_UNAVAILABLE/,
    );
  });
  it("blocks archive/delete for future visits and catches a booking after inspection", async () => {
    const before = await impact(kind);
    const a = await book();
    expect((await impact(kind)).future).toBe(1);
    for (const verb of ["delete", "archive"])
      await fails(
        "admin_catalog_action",
        [kind, id, verb, before.revision],
        /CATALOG_FUTURE_BOOKINGS/,
      );
    const snapshot = await call<AppData>("get_admin_snapshot");
    expect(snapshot.appointments[0]).toEqual(a);
    expect(
      (kind === "master" ? snapshot.masters : snapshot.services).find(
        (x) => x.id === id,
      )?.archived,
    ).toBe(false);
  });
  it("preserves history, access tokens, notifications, photos and bindings; restores availability", async () => {
    const a = await book();
    await db.exec("reset role");
    await db.query(
      "update public.appointments set start_at=start_at-interval '10 days',end_at=end_at-interval '10 days',status='completed' where id=$1",
      [a.id],
    );
    await role();
    const before = await call<AppData>("get_admin_snapshot");
    await fails(
      "admin_catalog_action",
      [kind, id, "delete", before.revision],
      /CATALOG_HAS_HISTORY/,
    );
    const archived = await action(kind, "archive");
    expect(archived.appointments).toEqual(before.appointments);
    expect(archived.notifications).toEqual(before.notifications);
    expect(archived.masters.find((m) => m.id === "aida")?.photo).toBe(
      before.masters.find((m) => m.id === "aida")?.photo,
    );
    expect(archived.masters.find((m) => m.id === "aida")?.serviceIds).toEqual(
      before.masters.find((m) => m.id === "aida")?.serviceIds,
    );
    const publicData = await call<AppData>("get_public_catalog");
    expect(
      (kind === "master" ? publicData.masters : publicData.services).some(
        (x) => x.id === id,
      ),
    ).toBe(false);
    expect(
      await call("get_available_slots", [
        "haircut",
        "aida",
        addDays(today(), 2),
        null,
        null,
      ]),
    ).toEqual([]);
    await fails(
      "create_appointment",
      [crypto.randomUUID(), "f".repeat(64), payload()],
      /SLOT_UNAVAILABLE/,
    );
    // Same trusted entry used by the guest Edge gateway cannot bypass the archive.
    await role("service_role", "");
    await fails(
      "booking_gateway_execute",
      [
        "create",
        {
          p_request_id: crypto.randomUUID(),
          p_manage_token: "f".repeat(64),
          p_payload: payload(),
        },
      ],
      /SLOT_UNAVAILABLE/,
    );
    const old = await call<Appointment>("booking_gateway_execute", [
      "read",
      { p_id: a.id, p_manage_token: "e".repeat(64) },
    ]);
    expect(old.id).toBe(a.id);
    await role();
    const restored = await action(kind, "restore");
    expect(
      (kind === "master" ? restored.masters : restored.services).find(
        (x) => x.id === id,
      )?.archived,
    ).toBe(false);
    expect(
      (
        await call<Appointment>("create_appointment", [
          crypto.randomUUID(),
          "f".repeat(64),
          payload(),
        ])
      ).masterId,
    ).toBe("aida");
  });
  it("retains cancelled bookings and prevents reactivation while archived", async () => {
    const a = await book();
    const cancelled = await call<Appointment>("cancel_appointment", [
      a.id,
      null,
      crypto.randomUUID(),
      a.version,
    ]);
    expect((await impact(kind)).future).toBe(0);
    const snapshot = await action(kind, "archive");
    expect(snapshot.appointments[0].status).toBe("cancelled");
    await fails(
      "admin_set_status",
      [a.id, "confirmed", crypto.randomUUID(), cancelled.version],
      /SLOT_UNAVAILABLE/,
    );
    await fails(
      "admin_catalog_action",
      [kind, id, "delete", snapshot.revision],
      /CATALOG_HAS_HISTORY/,
    );
  });
  it("rejects rescheduling directly into an archived target", async () => {
    const initial = await call<AppData>("get_admin_snapshot");
    const master = initial.masters.find((m) => m.id === "aida")!;
    const service = initial.services.find((s) => s.id === "haircut")!;
    const target = "archive-move-target";
    const changes =
      kind === "master"
        ? {
            masters: [
              {
                ...master,
                id: target,
                photo: "",
                photoAssetId: null,
                photoVersion: 0,
              },
            ],
          }
        : {
            services: [{ ...service, id: target }],
            masters: [
              { ...master, serviceIds: [...master.serviceIds, target] },
            ],
          };
    await call("admin_apply_changes", [changes, initial.revision, false]);
    const a = await book();
    const targetImpact = await call<CatalogImpact>("admin_catalog_impact", [
      kind,
      target,
    ]);
    await call("admin_catalog_action", [
      kind,
      target,
      "archive",
      targetImpact.revision,
    ]);
    await fails(
      "reschedule_appointment",
      [
        a.id,
        null,
        crypto.randomUUID(),
        a.version,
        {
          ...payload(),
          [kind === "master" ? "masterId" : "serviceId"]: target,
        },
      ],
      /SLOT_UNAVAILABLE/,
    );
    expect(
      (await call<AppData>("get_admin_snapshot")).appointments.find(
        (row) => row.id === a.id,
      ),
    ).toEqual(a);
  });
});

it("requires active admin for inspection/actions and preserves the media authorization fix", async () => {
  for (const [name, user] of [
    ["anon", ""],
    ["authenticated", TEST_USER_ID],
    ["authenticated", TEST_ADMIN_ID],
  ]) {
    if (user === TEST_ADMIN_ID) {
      await db.exec("reset role");
      await db.exec("update private.admin_users set active=false");
    }
    await role(name, user);
    await fails(
      "admin_catalog_impact",
      ["master", "aida"],
      /permission denied|ADMIN_REQUIRED/,
    );
    for (const verb of ["delete", "archive", "restore"])
      await fails(
        "admin_catalog_action",
        ["master", "aida", verb, 1],
        /permission denied|ADMIN_REQUIRED/,
      );
  }
  await role("service_role", "");
  await fails("media_begin_upload", [TEST_ADMIN_ID], /ADMIN_REQUIRED/);
  await fails(
    "media_finish_upload",
    [TEST_ADMIN_ID, crypto.randomUUID(), 10, 10, 100],
    /ADMIN_REQUIRED/,
  );
  await fails("media_asset_paths", [[], TEST_ADMIN_ID], /ADMIN_REQUIRED/);
});

it("rejects stale changes and preserves a hidden service on restoration", async () => {
  const before = await impact("service");
  await action("master", "archive");
  await fails(
    "admin_catalog_action",
    ["service", "haircut", "archive", before.revision],
    /DATA_CHANGED/,
  );
  await db.exec("reset role");
  await db.exec("update public.services set active=false where id='haircut'");
  await role();
  await action("service", "archive");
  const restored = await action("service", "restore");
  expect(restored.services.find((s) => s.id === "haircut")?.active).toBe(false);
});

it("keeps archived and shared photos safe for the existing garbage collector", async () => {
  await db.exec("reset role");
  const asset = (
    await db.query<{ id: string }>(
      "insert into private.site_media_assets(state,created_at) values('ready',now()-interval '2 days') returning id",
    )
  ).rows[0].id;
  await db.query(
    "update public.masters set photo_asset_id=$1 where id='aida'",
    [asset],
  );
  await role();
  await action("master", "archive");
  await role("service_role", "");
  expect(await call("media_gc_claim")).toEqual([]);
  await db.exec("reset role");
  await db.query(
    "update private.site_images set asset_id=$1,legacy_src='' where id='hero'",
    [asset],
  );
  await role();
  await action("master", "delete");
  await role("service_role", "");
  expect(await call("media_gc_claim")).toEqual([]);
  await db.exec("reset role");
  await db.exec("update private.site_images set asset_id=null where id='hero'");
  await role("service_role", "");
  expect(await call("media_gc_claim")).toEqual([
    { id: asset, path: asset + ".webp" },
  ]);
});

it("also blocks an ongoing visit and future non-cancelled terminal statuses", async () => {
  const a = await book();
  for (const status of ["arrived", "completed", "noshow"]) {
    await db.exec("reset role");
    await db.query("update public.appointments set status=$1 where id=$2", [
      status,
      a.id,
    ]);
    await role();
    expect((await impact("master")).future).toBe(1);
  }
  await db.exec("reset role");
  await db.query(
    "update public.appointments set start_at=now()-interval '30 minutes',end_at=now()+interval '30 minutes',status='arrived' where id=$1",
    [a.id],
  );
  await role();
  expect((await impact("service")).future).toBe(1);
  const state = await impact("master");
  await fails(
    "admin_catalog_action",
    ["master", "aida", "archive", state.revision],
    /CATALOG_FUTURE_BOOKINGS/,
  );
});

it("upgrades an existing 001–006 database without altering bookings, photos or membership", async () => {
  const existing = await createTestDatabase({ legacy: true });
  try {
    for (const file of migrationFiles().filter((f) => /000[56]_/.test(f.name)))
      await existing.exec(file.sql);
    await existing.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [TEST_ADMIN_ID],
    );
    await existing.exec("set role authenticated");
    const before = (
      await existing.query<{ result: Appointment }>(
        "select public.create_appointment($1,$2,$3) as result",
        [crypto.randomUUID(), "c".repeat(64), payload()],
      )
    ).rows[0].result;
    await existing.exec("reset role");
    const photo = (
      await existing.query<{ photo: string }>(
        "select photo from public.masters where id='aida'",
      )
    ).rows[0].photo;
    // Emulate the manual fix the owner has already applied.
    await existing.exec(
      migrationFiles().find((f) => f.name.includes("0007_"))!.sql,
    );
    await existing.exec(
      migrationFiles().find((f) => f.name.includes("0008_"))!.sql,
    );
    await existing.exec("set role authenticated");
    const after = (
      await existing.query<{ result: AppData }>(
        "select public.get_admin_snapshot() as result",
      )
    ).rows[0].result;
    expect(after.appointments[0]).toMatchObject(before);
    expect(after.appointments[0].masterName).toBe(
      after.masters.find((m) => m.id === "aida")?.name,
    );
    expect(after.masters.find((m) => m.id === "aida")?.photo).toBe(photo);
    expect(after.masters.every((m) => m.archived === false)).toBe(true);
    expect(after.services.every((s) => s.archived === false)).toBe(true);
    expect(
      (
        await existing.query<{ result: boolean }>(
          "select public.is_admin() as result",
        )
      ).rows[0].result,
    ).toBe(true);
  } finally {
    await existing.close();
  }
}, 60000);
