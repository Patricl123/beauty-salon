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
  TEST_ADMIN_ID,
  TEST_USER_ID,
} from "../../test-support/database";
import type { AppData, Appointment } from "../types";
import { addDays, today } from "./schedule";
const token = "a".repeat(64);
const otherToken = "b".repeat(64);
let db: PGlite;
const payload = (patch: Record<string, unknown> = {}) => ({
  serviceId: "haircut",
  masterId: "aida",
  date: addDays(today(), 2),
  time: "10:00",
  clientName: "Тест БД",
  phone: "+996000000001",
  comment: "",
  expectedPrice: 2200,
  expectedDuration: 60,
  consent: true,
  owner: "visitor",
  ...patch,
});
async function role(name: "anon" | "authenticated", user = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${name}`);
}
async function call<T>(name: string, args: unknown[] = []): Promise<T> {
  const result = await db.query<{ result: T }>(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
    args,
  );
  return result.rows[0].result;
}
async function fails(sql: string, args: unknown[], message: RegExp) {
  await db.exec("savepoint expected_error");
  try {
    await expect(db.query(sql, args)).rejects.toThrow(message);
  } finally {
    await db.exec("rollback to savepoint expected_error");
  }
}
const create = (body = payload(), key = crypto.randomUUID(), secret = token) =>
  call<Appointment>("create_appointment", [key, secret, body]);
beforeAll(async () => {
  db = await createTestDatabase({ legacy: true });
}, 60000);
beforeEach(async () => {
  await db.exec("begin");
  await role("anon");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});
describe("Baseline business rules in the four already deployed migrations", () => {
  it("applies baseline migrations and exposes only the public catalog", async () => {
    const data = await call<AppData>("get_public_catalog");
    expect(data.services).toHaveLength(13);
    expect(data.masters).toHaveLength(5);
    expect(data.appointments).toEqual([]);
    expect(data.clientNotes).toEqual({});
    await fails("select * from public.appointments", [], /permission denied/i);
    await fails("select * from private.admin_users", [], /permission denied/i);
  });
  it("creates using server-derived price/duration and returns Bishkek date/time", async () => {
    const a = await create();
    expect(a.price).toBe(2200);
    expect(a.duration).toBe(60);
    expect(a.time).toBe("10:00");
    expect(a.date).toBe(addDays(today(), 2));
    expect(a.version).toBe(1);
    const own = await call<Appointment>("get_appointment", [a.id, token]);
    expect(own.id).toBe(a.id);
  });
  it("replays the same creation once, including notification generation", async () => {
    const key = crypto.randomUUID();
    const a = await create(payload(), key);
    const b = await create(payload(), key);
    expect(b.id).toBe(a.id);
    await role("authenticated", TEST_ADMIN_ID);
    const data = await call<AppData>("get_admin_snapshot");
    expect(data.appointments).toHaveLength(1);
    expect(data.notifications.filter((n) => !n.planned)).toHaveLength(3);
  });
  it("rejects reusing a request key with another payload", async () => {
    const key = crypto.randomUUID();
    await create(payload(), key);
    await fails(
      "select public.create_appointment($1,$2,$3)",
      [key, token, payload({ time: "11:00" })],
      /IDEMPOTENCY_KEY_REUSED/,
    );
  });
  it("rejects overlap even when clients use different request keys and tokens", async () => {
    await create();
    await fails(
      "select public.create_appointment($1,$2,$3)",
      [crypto.randomUUID(), otherToken, payload({ time: "10:30" })],
      /SLOT_UNAVAILABLE|overlap/,
    );
    const next = await create(
      payload({ time: "11:00" }),
      crypto.randomUUID(),
      otherToken,
    );
    expect(next.time).toBe("11:00");
  });
  it("the exclusion constraint rejects overlapping direct SQL independently of RPC", async () => {
    const a = await create();
    await db.exec("reset role");
    await fails(
      `insert into public.appointments(service_id,master_id,start_at,end_at,duration,price,service_name,client_name,phone) select service_id,master_id,start_at + interval '30 minutes',end_at + interval '30 minutes',duration,price,service_name,client_name,phone from public.appointments where id=$1`,
      [a.id],
      /exclusion constraint|conflicting key/i,
    );
  });
  it("only the capability owner or an administrator can read, move or cancel", async () => {
    const a = await create();
    await fails(
      "select public.get_appointment($1,$2)",
      [a.id, otherToken],
      /FORBIDDEN/,
    );
    await fails(
      "select public.cancel_appointment($1,$2,$3,$4)",
      [a.id, otherToken, crypto.randomUUID(), 1],
      /FORBIDDEN/,
    );
    await fails(
      "select public.reschedule_appointment($1,$2,$3,$4,$5)",
      [a.id, otherToken, crypto.randomUUID(), 1, payload({ time: "11:00" })],
      /FORBIDDEN/,
    );
  });
  it("rescheduling is atomic, idempotent, frees old time and blocks the new interval", async () => {
    const a = await create();
    const key = crypto.randomUUID();
    const args = [a.id, token, key, 1, payload({ time: "11:00" })];
    const moved = await call<Appointment>("reschedule_appointment", args);
    expect(moved.id).toBe(a.id);
    expect(moved.version).toBe(2);
    expect(
      (await call<Appointment>("reschedule_appointment", args)).version,
    ).toBe(2);
    const slots = await call<{ time: string }[]>("get_available_slots", [
      "haircut",
      "aida",
      a.date,
      null,
      null,
    ]);
    expect(slots.some((s) => s.time === "10:00")).toBe(true);
    expect(slots.some((s) => s.time === "11:00")).toBe(false);
  });
  it("a failed move retains the original slot and snapshot", async () => {
    const a = await create();
    await create(payload({ time: "11:00" }), crypto.randomUUID(), otherToken);
    await fails(
      "select public.reschedule_appointment($1,$2,$3,$4,$5)",
      [a.id, token, crypto.randomUUID(), 1, payload({ time: "11:00" })],
      /SLOT_UNAVAILABLE/,
    );
    expect(
      (await call<Appointment>("get_appointment", [a.id, token])).time,
    ).toBe("10:00");
  });
  it("cancellation is idempotent and frees the interval and planned reminders", async () => {
    const a = await create();
    const args = [a.id, token, crypto.randomUUID(), 1];
    expect((await call<Appointment>("cancel_appointment", args)).status).toBe(
      "cancelled",
    );
    expect((await call<Appointment>("cancel_appointment", args)).version).toBe(
      2,
    );
    await create(payload(), crypto.randomUUID(), otherToken);
    await role("authenticated", TEST_ADMIN_ID);
    const data = await call<AppData>("get_admin_snapshot");
    expect(
      data.notifications.some((n) => n.appointmentId === a.id && n.planned),
    ).toBe(false);
  });
  it("rejects stale versions instead of overwriting newer changes", async () => {
    const a = await create();
    await call("reschedule_appointment", [
      a.id,
      token,
      crypto.randomUUID(),
      1,
      payload({ time: "11:00" }),
    ]);
    await fails(
      "select public.cancel_appointment($1,$2,$3,$4)",
      [a.id, token, crypto.randomUUID(), 1],
      /BOOKING_CHANGED/,
    );
  });
  it("validates consent, contacts, quotes, past time, breaks and service eligibility on server", async () => {
    for (const [patch, error] of [
      [{ consent: false }, /CONSENT_REQUIRED/],
      [{ phone: "123" }, /INVALID_CONTACTS/],
      [{ expectedPrice: 1 }, /QUOTE_CHANGED/],
      [{ expectedDuration: 15 }, /QUOTE_CHANGED/],
      [{ time: "13:00" }, /SLOT_UNAVAILABLE/],
      [{ time: "19:30" }, /SLOT_UNAVAILABLE/],
      [{ masterId: "aliya" }, /SLOT_UNAVAILABLE/],
      [{ date: addDays(today(), -1) }, /TIME_OUT_OF_RANGE/],
    ] as [Record<string, unknown>, RegExp][]) {
      await fails(
        "select public.create_appointment($1,$2,$3)",
        [crypto.randomUUID(), token, payload(patch)],
        error,
      );
    }
  });
  it("honours vacation, days off and block intervals", async () => {
    await db.exec("reset role");
    await db.query(
      "update public.masters set vacation_start=$1,vacation_end=$1 where id=$2",
      [addDays(today(), 2), "aida"],
    );
    await role("anon");
    expect(
      await call("get_available_slots", [
        "haircut",
        "aida",
        addDays(today(), 2),
        null,
        null,
      ]),
    ).toEqual([]);
    await db.exec("reset role");
    await db.query(
      "update public.masters set vacation_start=null,vacation_end=null,days_off=array[$1::date] where id='aida'",
      [addDays(today(), 2)],
    );
    await role("anon");
    expect(
      await call("get_available_slots", [
        "haircut",
        "aida",
        addDays(today(), 2),
        null,
        null,
      ]),
    ).toEqual([]);
  });
  it("normal authenticated users cannot grant themselves admin, read clients, or call admin mutations", async () => {
    await role("authenticated", TEST_USER_ID);
    expect(await call("is_admin")).toBe(false);
    expect((await db.query("select * from public.appointments")).rows).toEqual(
      [],
    );
    await fails(
      "insert into private.admin_users(user_id) values($1)",
      [TEST_USER_ID],
      /permission denied/,
    );
    await fails("select public.get_admin_snapshot()", [], /ADMIN_REQUIRED/);
    await fails(
      "select public.admin_apply_changes($1,$2,$3)",
      [{}, 1, false],
      /ADMIN_REQUIRED/,
    );
    await fails(
      "update public.services set price=1 where id='haircut'",
      [],
      /permission denied/,
    );
  });
  it("an administrator can access data and the role revocation applies immediately", async () => {
    await create();
    await role("authenticated", TEST_ADMIN_ID);
    expect(await call("is_admin")).toBe(true);
    expect(
      (await call<AppData>("get_admin_snapshot")).appointments,
    ).toHaveLength(1);
    await db.exec("reset role");
    await db.query(
      "update private.admin_users set active=false where user_id=$1",
      [TEST_ADMIN_ID],
    );
    await role("authenticated", TEST_ADMIN_ID);
    expect(await call("is_admin")).toBe(false);
    await fails("select public.get_admin_snapshot()", [], /ADMIN_REQUIRED/);
  });
  it("requires explicit conflict confirmation for schedule changes and keeps appointments", async () => {
    await create();
    await role("authenticated", TEST_ADMIN_ID);
    const before = await call<AppData>("get_admin_snapshot");
    const master = {
      ...before.masters.find((m) => m.id === "aida")!,
      days: [],
    };
    await fails(
      "select public.admin_apply_changes($1,$2,$3)",
      [{ masters: [master] }, before.revision, false],
      /SCHEDULE_CONFLICT/,
    );
    const after = await call<AppData>("admin_apply_changes", [
      { masters: [master] },
      before.revision,
      true,
    ]);
    expect(after.appointments).toHaveLength(1);
    expect(after.masters.find((m) => m.id === "aida")?.days).toEqual([]);
    await fails(
      "select public.admin_apply_changes($1,$2,$3)",
      [{}, before.revision, false],
      /DATA_CHANGED/,
    );
  });
  it("rejects direct table writes by administrators and exposing private helper functions", async () => {
    await role("authenticated", TEST_ADMIN_ID);
    await fails("delete from public.appointments", [], /permission denied/);
    await fails("select private.actor_key($1)", [token], /permission denied/);
  });
  it("returns only times/master ids for public availability, never customer data", async () => {
    await create();
    const slots = await call<Record<string, unknown>[]>("get_available_slots", [
      "haircut",
      "aida",
      addDays(today(), 2),
      null,
      null,
    ]);
    expect(slots.length).toBeGreaterThan(0);
    expect(
      slots.every((s) => Object.keys(s).sort().join(",") === "masterId,time"),
    ).toBe(true);
  });
});
