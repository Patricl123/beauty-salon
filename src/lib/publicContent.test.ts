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
import type { AppData, Appointment } from "../types";
import type { SiteContent } from "./siteContent";
import { initialContent } from "./siteContent";
import { createSeed } from "../data/seed";
import { addDays, getSlots, today } from "./schedule";
import {
  isPublishedMaster,
  isPublishedWork,
  locationLinks,
  safeMapUrl,
} from "./publicContent";

it("never infers real masters from names/photos and never publishes seed portfolio", () => {
  const data = createSeed();
  expect(data.masters.filter(isPublishedMaster)).toEqual([]);
  expect(getSlots(data, "haircut", "any", addDays(today(), 2))).toEqual([]);
  expect(
    isPublishedMaster({
      ...data.masters[0],
      name: "Настоящее имя",
      photo: "https://example.test/photo.jpg",
    }),
  ).toBe(false);
  expect(isPublishedMaster({ ...data.masters[0], published: true })).toBe(true);
  expect(
    isPublishedMaster({ ...data.masters[0], published: true, archived: true }),
  ).toBe(false);
  expect(initialContent.items.filter(isPublishedWork)).toEqual([]);
  const image = {
    ...initialContent.items.find((i) => i.kind === "portfolio")!,
    assetId: crypto.randomUUID(),
  };
  expect(isPublishedWork(image)).toBe(true);
  expect(isPublishedWork({ ...image, visible: false })).toBe(false);
});

it("allows only map providers, requires confirmation and falls back to the current address", () => {
  const settings = createSeed().settings;
  expect(locationLinks({...settings,mapConfirmed:false}).route).toContain(
    encodeURIComponent(settings.address),
  );
  expect(locationLinks({...settings,mapConfirmed:false}).embed).toBe("");
  for (const value of [
    "javascript:alert(1)",
    "https://yandex.ru.evil.test/maps/",
    "https://yandex.ru@evil.test/maps/",
    "https://evil.test/",
    "https://yandex.ru:444/maps/",
    "https://www.google.com/search?q=test",
  ])
    expect(safeMapUrl(value)).toBe("");
  const valid = {
    ...settings,
    mapConfirmed: false,
    mapUrl: "https://yandex.ru/maps/?text=test",
    mapEmbedUrl: "https://yandex.ru/map-widget/v1/?text=test",
  };
  expect(locationLinks(valid).embed).toBe("");
  expect(locationLinks({ ...valid, mapConfirmed: true }).embed).toBe(
    valid.mapEmbedUrl,
  );
  expect(
    safeMapUrl("https://www.google.com/maps/embed?pb=test", true),
  ).not.toBe("");
  expect(safeMapUrl("https://2gis.kg/bishkek/geo/123", true)).toBe("");
});

describe("Trusted publication and location settings", () => {
  let db: PGlite;
  async function role(name = "authenticated", user = TEST_ADMIN_ID) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
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
    clientName: "Тест публикации",
    phone: "+996000000088",
    expectedPrice: 2200,
    expectedDuration: 60,
    consent: true,
  });
  const snapshot = () => call<AppData>("get_admin_snapshot");
  async function publish(published: boolean) {
    const data = await snapshot();
    return call<AppData>("admin_apply_changes", [
      {
        masters: [{ ...data.masters.find((m) => m.id === "aida"), published }],
      },
      data.revision,
      false,
    ]);
  }
  beforeAll(async () => {
    db = await createTestDatabase({ unpublished: true });
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

  it("keeps unconfirmed profiles in admin and rejects direct admin/guest bookings", async () => {
    expect((await snapshot()).masters).toHaveLength(5);
    expect((await call<AppData>("get_public_catalog")).masters).toEqual([]);
    expect(
      await call("get_available_slots", [
        "haircut",
        "any",
        addDays(today(), 2),
        null,
        null,
      ]),
    ).toEqual([]);
    await fails(
      "create_appointment",
      [crypto.randomUUID(), "a".repeat(64), payload()],
      /SLOT_UNAVAILABLE/,
    );
    await role("service_role", "");
    await fails(
      "booking_gateway_execute",
      [
        "create",
        {
          p_request_id: crypto.randomUUID(),
          p_manage_token: "a".repeat(64),
          p_payload: payload(),
        },
      ],
      /SLOT_UNAVAILABLE/,
    );
  });
  it("publishes explicitly, creates a booking, then hides without losing that booking or photo", async () => {
    const original = await snapshot();
    await publish(true);
    expect(
      (await call<AppData>("get_public_catalog")).masters.map((m) => m.id),
    ).toEqual(["aida"]);
    const a = await call<Appointment>("create_appointment", [
      crypto.randomUUID(),
      "a".repeat(64),
      payload(),
    ]);
    const hidden = await publish(false);
    expect(hidden.appointments.find((row) => row.id === a.id)).toEqual(a);
    expect(hidden.masters.find((m) => m.id === "aida")?.photo).toBe(
      original.masters.find((m) => m.id === "aida")?.photo,
    );
    expect((await call<AppData>("get_public_catalog")).masters).toEqual([]);
    await fails(
      "reschedule_appointment",
      [
        a.id,
        null,
        crypto.randomUUID(),
        a.version,
        { ...payload(), time: "11:00" },
      ],
      /SLOT_UNAVAILABLE/,
    );
    const cancelled = await call<Appointment>("cancel_appointment", [
      a.id,
      null,
      crypto.randomUUID(),
      a.version,
    ]);
    expect(cancelled.status).toBe("cancelled");
    await publish(true);
    const state = await snapshot();
    await call("admin_catalog_action", [
      "master",
      "aida",
      "archive",
      state.revision,
    ]);
    expect((await call<AppData>("get_public_catalog")).masters).toEqual([]);
  });
  it("requires active admin, boolean confirmation and current revision", async () => {
    const data = await snapshot();
    const changes = { masters: [{ ...data.masters[0], published: true }] };
    await role("authenticated", TEST_USER_ID);
    await fails(
      "admin_apply_changes",
      [changes, data.revision, false],
      /ADMIN_REQUIRED/,
    );
    await role("anon", "");
    await fails(
      "admin_apply_changes",
      [changes, data.revision, false],
      /permission denied/,
    );
    await role();
    await fails(
      "admin_apply_changes",
      [
        { masters: [{ ...data.masters[0], published: "true" }] },
        data.revision,
        false,
      ],
      /INVALID_CHANGES/,
    );
    await publish(true);
    await fails(
      "admin_apply_changes",
      [{masters: [(await snapshot()).masters[0]]}, data.revision, false],
      /DATA_CHANGED/,
    );
    await db.exec("reset role");
    await db.exec("update private.admin_users set active=false");
    await role();
    await fails(
      "admin_apply_changes",
      [changes, data.revision, false],
      /ADMIN_REQUIRED/,
    );
  });
  it("keeps demonstration images in admin while showing only published uploads", async () => {
    const before = await call<SiteContent>("get_site_content_admin");
    expect(before.items.filter((i) => i.kind === "portfolio")).toHaveLength(3);
    expect(
      (await call<SiteContent>("get_site_content")).items.filter(
        (i) => i.kind === "portfolio",
      ),
    ).toEqual([]);
    await db.exec("reset role");
    const asset = (
      await db.query<{ id: string }>(
        "insert into private.site_media_assets(state) values('ready') returning id",
      )
    ).rows[0].id;
    await role();
    const items = before.items.map((i) =>
      i.id === "portfolio:hair"
        ? { ...i, assetId: asset, legacySrc: "", visible: true }
        : i,
    );
    const saved = await call<SiteContent>("save_site_content", [
      items,
      before.revision,
    ]);
    expect(
      (await call<SiteContent>("get_site_content")).items
        .filter((i) => i.kind === "portfolio")
        .map((i) => i.assetId),
    ).toEqual([asset]);
    await call("save_site_content", [
      items.map((i) =>
        i.id === "portfolio:hair" ? { ...i, visible: false } : i,
      ),
      saved.revision,
    ]);
    expect(
      (await call<SiteContent>("get_site_content")).items.filter(
        (i) => i.kind === "portfolio",
      ),
    ).toEqual([]);
    expect(
      (await call<SiteContent>("get_site_content_admin")).items,
    ).toHaveLength(before.items.length);
  });
  it("saves address, description and map in the existing settings transaction; rejects unsafe embeds", async () => {
    const before = await snapshot();
    expect(before.settings.address).toContain("Проспект Манаса, 38");
    const settings = {
      ...before.settings,
      address: "Бишкек, проверенный адрес владельца",
      buildingDescription: "Описание владельца",
      mapUrl: "https://2gis.kg/bishkek/geo/123",
      mapEmbedUrl: "https://yandex.ru/map-widget/v1/?text=test",
      mapConfirmed: true,
    };
    const saved = await call<AppData>("admin_apply_changes", [
      { settings },
      before.revision,
      false,
    ]);
    expect((await call<AppData>("get_public_catalog")).settings).toEqual(
      settings,
    );
    await fails(
      "admin_apply_changes",
      [
        {
          settings: { ...settings, mapEmbedUrl: "https://evil.test/" },
          masters: [{ ...saved.masters[0], published: true }],
        },
        saved.revision,
        false,
      ],
      /check constraint/,
    );
    expect((await snapshot()).revision).toBe(saved.revision);
    expect((await snapshot()).masters[0].published).toBe(false);
  });
});

it("migration 009 preserves an existing appointment and custom address but requires explicit profile confirmation", async () => {
  const db = await createTestDatabase({ legacy: true });
  try {
    for (const file of migrationFiles().filter((f) => /000[5-8]_/.test(f.name)))
      await db.exec(file.sql);
    await db.exec(
      "update public.salon_settings set address='Адрес владельца'; update public.masters set photo='https://example.test/owner.jpg' where id='aida'",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      TEST_ADMIN_ID,
    ]);
    const payload = {
      serviceId: "haircut",
      masterId: "aida",
      date: addDays(today(), 2),
      time: "10:00",
      clientName: "Старый клиент",
      phone: "+996000000088",
      expectedPrice: 2200,
      expectedDuration: 60,
      consent: true,
    };
    const before = (
      await db.query<{ result: Appointment }>(
        "select public.create_appointment($1,$2,$3) as result",
        [crypto.randomUUID(), "b".repeat(64), payload],
      )
    ).rows[0].result;
    await db.exec(migrationFiles().find((f) => f.name.includes("0009_"))!.sql);
    const after = (
      await db.query<{ result: AppData }>(
        "select public.get_admin_snapshot() as result",
      )
    ).rows[0].result;
    expect(after.appointments[0]).toEqual(before);
    expect(after.settings.address).toBe("Адрес владельца");
    expect(after.masters.find((m) => m.id === "aida")?.photo).toBe(
      "https://example.test/owner.jpg",
    );
    expect(after.masters.every((m) => m.published === false)).toBe(true);
  } finally {
    await db.close();
  }
}, 60000);
