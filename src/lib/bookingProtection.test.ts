import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  migrationFiles,
  TEST_ADMIN_ID,
  TEST_USER_ID,
} from "../../test-support/database";
import {
  createHandler,
  type Dependencies,
} from "../../supabase/functions/booking-gateway/handler";
import { addDays, today } from "./schedule";
let db: PGlite;
const token = "c".repeat(64);
const body = (patch: Record<string, unknown> = {}) => ({
  serviceId: "haircut",
  masterId: "aida",
  date: addDays(today(), 2),
  time: "10:00",
  clientName: "Защищённый тест",
  phone: "+996000000051",
  comment: "",
  expectedPrice: 2200,
  expectedDuration: 60,
  consent: true,
  owner: "visitor",
  ...patch,
});
async function sqlRpc(
  name: string,
  args: unknown[],
  role = "service_role",
  user = "",
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role " + role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const result = await tx.query<{ result: any }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    );
    return result.rows[0].result;
  });
}
const rpc: Dependencies["rpc"] = async (name, args) => {
  const values =
    name === "booking_gateway_limit"
      ? [args.p_operation, args.p_target, args.p_phone]
      : [args.p_operation, args.p_args];
  try {
    return { data: await sqlRpc(name, values) };
  } catch (error) {
    const e = error as { code: string; message: string };
    return { data: null, error: { code: e.code, message: e.message } };
  }
};
function server(overrides: Partial<Dependencies> = {}) {
  const used = new Set<string>();
  return createHandler({
    rpc,
    secret: "TEST_ONLY",
    hostnames: ["salon.example"],
    origins: ["https://salon.example"],
    fetch: vi.fn(async (_url, options) => {
      const sent = JSON.parse(options!.body as string);
      const success =
        sent.response.startsWith("good-") && !used.has(sent.response);
      used.add(sent.response);
      return Response.json({
        success,
        hostname: "salon.example",
        action: "salon_booking",
        challenge_ts: new Date().toISOString(),
      });
    }) as typeof fetch,
    ...overrides,
  });
}
function request(
  operation: string,
  args: Record<string, unknown>,
  captchaToken?: string,
  headers: Record<string, string> = {},
) {
  return new Request("https://edge.example/booking-gateway", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://salon.example",
      ...headers,
    },
    body: JSON.stringify({ operation, args, captchaToken }),
  });
}
const createArgs = (patch = {}, key = crypto.randomUUID(), access = token) => ({
  p_request_id: key,
  p_manage_token: access,
  p_payload: body(patch),
});
const create = (handler: ReturnType<typeof server>, args = createArgs()) =>
  handler(request("create", args, "good-" + crypto.randomUUID()));
beforeAll(async () => {
  db = await createTestDatabase();
}, 60000);
beforeEach(async () => {
  await db.exec(
    "truncate public.appointments cascade; truncate private.booking_rate_buckets;",
  );
});
afterAll(async () => {
  await db?.close();
});
describe("Protected booking gateway with real PostgreSQL quotas and permissions", () => {
  it("rejects a missing or invalid CAPTCHA and does not create an appointment", async () => {
    const handler = server();
    expect((await handler(request("create", createArgs()))).status).toBe(400);
    expect(
      (await handler(request("create", createArgs(), "invalid"))).status,
    ).toBe(400);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.appointments",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query<{ hits: number }>(
          "select hits from private.booking_rate_buckets where bucket='create:minute'",
        )
      ).rows[0].hits,
    ).toBe(2);
  });
  it("requires the correct hostname, action and fresh challenge timestamp", async () => {
    for (const patch of [
      { hostname: "evil.example" },
      { action: "another_form" },
      { challenge_ts: "2000-01-01T00:00:00Z" },
      { challenge_ts: undefined },
    ]) {
      const handler = server({
        fetch: vi.fn(async () =>
          Response.json({
            success: true,
            hostname: "salon.example",
            action: "salon_booking",
            challenge_ts: new Date().toISOString(),
            ...patch,
          }),
        ) as typeof fetch,
      });
      const result = await handler(
        request(
          "create",
          {
            ...createArgs(),
            p_payload: body({
              phone:
                "+9960000000" +
                String(60 + Object.keys(patch).length).padStart(2, "0"),
            }),
          },
          "good-x",
        ),
      );
      expect(result.status).toBe(400);
      expect((await result.json()).error.code).toBe("CAPTCHA_REJECTED");
      await db.exec("truncate private.booking_rate_buckets");
    }
  });
  it("does not accept a reused Turnstile token even with a reused business request id", async () => {
    const handler = server(),
      args = createArgs(),
      captcha = "good-once";
    expect((await handler(request("create", args, captcha))).status).toBe(200);
    const repeated = await handler(request("create", args, captcha));
    expect((await repeated.json()).error.code).toBe("CAPTCHA_REJECTED");
  });
  it("shares quotas between function instances and ignores forged IP headers", async () => {
    const handlers = [server(), server()];
    for (let i = 0; i < 30; i++) {
      const result = await handlers[i % 2](
        request("create", {}, undefined, {
          "X-Forwarded-For": "1.2.3." + i,
          "CF-Connecting-IP": "8.8.8." + i,
        }),
      );
      expect(result.status).toBe(400);
    }
    const denied = await server()(
      request("create", createArgs(), "good-new-ip", {
        "X-Real-IP": "9.9.9.9",
      }),
    );
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("limits phone attempts and invalid management codes for the same target", async () => {
    const handler = server();
    for (let i = 0; i < 3; i++)
      expect((await handler(request("create", createArgs()))).status).toBe(400);
    expect((await create(handler)).status).toBe(429);
    const target = crypto.randomUUID();
    for (let i = 0; i < 30; i++)
      expect(
        (
          await handler(
            request("read", {
              p_id: target,
              p_manage_token: i.toString(16).padStart(64, "0"),
            }),
          )
        ).status,
      ).toBe(403);
    expect(
      (await handler(request("read", { p_id: target, p_manage_token: token })))
        .status,
    ).toBe(429);
  });
  it("limits move and cancel separately, counting failed access attempts", async () => {
    const handler = server();
    for (const operation of ["move", "cancel"]) {
      const args = {
        p_id: crypto.randomUUID(),
        p_manage_token: token,
        p_request_id: crypto.randomUUID(),
        p_expected_version: 1,
        ...(operation === "move" ? { p_payload: body() } : {}),
      };
      for (let i = 0; i < 6; i++)
        expect((await handler(request(operation, args))).status).toBe(403);
      expect((await handler(request(operation, args))).status).toBe(429);
    }
  });
  it("supports create/retry/read/availability/move/cancel while retaining idempotency and versions", async () => {
    const handler = server(),
      args = createArgs();
    const first = (await (await create(handler, args)).json()).data;
    const retry = (await (await create(handler, args)).json()).data;
    expect(retry.id).toBe(first.id);
    const own = await handler(
      request("read", { p_id: first.id, p_manage_token: token }),
    );
    expect((await own.json()).data.id).toBe(first.id);
    const slots = await handler(
      request("slots", {
        p_service_id: "haircut",
        p_master_id: "aida",
        p_date: first.date,
        p_exclude_id: first.id,
        p_manage_token: token,
      }),
    );
    expect((await slots.json()).data.some((s: any) => s.time === "10:00")).toBe(
      true,
    );
    const moveArgs = {
      p_id: first.id,
      p_manage_token: token,
      p_request_id: crypto.randomUUID(),
      p_expected_version: 1,
      p_payload: body({ time: "14:00" }),
    };
    const moved = (await (await handler(request("move", moveArgs))).json())
      .data;
    expect(moved.version).toBe(2);
    expect(moved.time).toBe("14:00");
    expect(
      (await (await handler(request("move", moveArgs))).json()).data.version,
    ).toBe(2);
    const stale = await handler(
      request("cancel", {
        p_id: first.id,
        p_manage_token: token,
        p_request_id: crypto.randomUUID(),
        p_expected_version: 1,
      }),
    );
    expect((await stale.json()).error.code).toBe("BOOKING_CHANGED");
    const cancelArgs = {
      p_id: first.id,
      p_manage_token: token,
      p_request_id: crypto.randomUUID(),
      p_expected_version: 2,
    };
    expect(
      (await (await handler(request("cancel", cancelArgs))).json()).data.status,
    ).toBe("cancelled");
    expect(
      (await (await handler(request("cancel", cancelArgs))).json()).data
        .version,
    ).toBe(3);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.appointments",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("retains overlap protection and rolls back a failed reschedule", async () => {
    const handler = server();
    const first = (await (await create(handler)).json()).data;
    const other = (
      await (
        await create(
          handler,
          createArgs(
            { time: "14:00", phone: "+996000000052" },
            crypto.randomUUID(),
            "d".repeat(64),
          ),
        )
      ).json()
    ).data;
    expect(other.id).toBeTruthy();
    const overlap = await create(
      handler,
      createArgs(
        { phone: "+996000000053" },
        crypto.randomUUID(),
        "e".repeat(64),
      ),
    );
    expect((await overlap.json()).error.code).toBe("SLOT_UNAVAILABLE");
    const failed = await handler(
      request("move", {
        p_id: first.id,
        p_manage_token: token,
        p_request_id: crypto.randomUUID(),
        p_expected_version: 1,
        p_payload: body({ time: "14:00" }),
      }),
    );
    expect((await failed.json()).error.code).toBe("SLOT_UNAVAILABLE");
    const own = (
      await (
        await handler(
          request("read", { p_id: first.id, p_manage_token: token }),
        )
      ).json()
    ).data;
    expect(own.time).toBe("10:00");
    expect(own.version).toBe(1);
  });
  it("denies direct RPC bypass to anon and ordinary authenticated users, including gateway helpers", async () => {
    const calls: [string, unknown[]][] = [
      ["create_appointment", [crypto.randomUUID(), token, body()]],
      ["get_appointment", [crypto.randomUUID(), token]],
      [
        "reschedule_appointment",
        [crypto.randomUUID(), token, crypto.randomUUID(), 1, body()],
      ],
      [
        "cancel_appointment",
        [crypto.randomUUID(), token, crypto.randomUUID(), 1],
      ],
      [
        "get_available_slots",
        ["haircut", "aida", addDays(today(), 2), null, null],
      ],
      [
        "get_next_available_slot",
        ["haircut", "any", addDays(today(), 2), null, null],
      ],
      ["booking_gateway_execute", ["create", createArgs()]],
      ["booking_gateway_limit", ["create", null, null]],
    ];
    for (const role of ["anon", "authenticated"])
      for (const [name, args] of calls)
        await expect(
          sqlRpc(
            name,
            args,
            role,
            role === "authenticated" ? TEST_USER_ID : "",
          ),
        ).rejects.toThrow(/permission denied|ADMIN_REQUIRED/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        return tx.query("select * from private.booking_rate_buckets");
      }),
    ).rejects.toThrow(/permission denied/);
  });
  it("allows an allowlisted administrator to create, move, set status and cancel without CAPTCHA", async () => {
    const admin = (name: string, args: unknown[]) =>
      sqlRpc(name, args, "authenticated", TEST_ADMIN_ID);
    const a = await admin("create_appointment", [
      crypto.randomUUID(),
      null,
      body({ owner: "salon" }),
    ]);
    expect(a.owner).toBe("salon");
    const moved = await admin("reschedule_appointment", [
      a.id,
      null,
      crypto.randomUUID(),
      1,
      body({ time: "14:00" }),
    ]);
    expect(moved.version).toBe(2);
    const confirmed = await admin("admin_set_status", [
      a.id,
      "confirmed",
      crypto.randomUUID(),
      2,
    ]);
    expect(confirmed.status).toBe("confirmed");
    const cancelled = await admin("admin_set_status", [
      a.id,
      "cancelled",
      crypto.randomUUID(),
      3,
    ]);
    expect(cancelled.status).toBe("cancelled");
  });
  it("does not let gateway callers assert an admin role or salon ownership", async () => {
    const handler = server();
    const response = await create(handler, createArgs({ owner: "salon" }));
    expect((await response.json()).error.code).toBe("ADMIN_REQUIRED");
    const injected = await handler(
      request("create", { ...createArgs(), is_admin: true }, "good-injection"),
    );
    expect(injected.status).toBe(400);
  });
  it("fails closed on quota or Siteverify outages and never returns raw database details", async () => {
    const handler = server({
      rpc: async () => ({
        data: null,
        error: { message: "Sensitive client +996000000051" },
      }),
    });
    expect(await (await create(handler)).text()).not.toContain("+996");
    const offline = server({
      fetch: vi.fn(async () => {
        throw new Error("provider secret");
      }) as typeof fetch,
    });
    const response = await create(offline);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider secret");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.appointments",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("counts failed SQL writes independently of the rolled-back appointment transaction", async () => {
    const handler = server();
    const result = await create(handler, createArgs({ consent: false }));
    expect((await result.json()).error.code).toBe("CONSENT_REQUIRED");
    expect(
      (
        await db.query<{ hits: number }>(
          "select hits from private.booking_rate_buckets where bucket='create:minute'",
        )
      ).rows[0].hits,
    ).toBe(1);
  });
  it("rejects oversized bodies and disallowed browser origins before processing", async () => {
    const handler = server();
    expect(
      (await handler(request("create", { padding: "x".repeat(17000) }))).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request("create", createArgs(), "good-origin", {
            Origin: "https://evil.example",
          }),
        )
      ).status,
    ).toBe(403);
  });
});
describe("Upgrade preserves already deployed data", () => {
  it("keeps existing appointments, codes, snapshots and admin grants intact", async () => {
    const legacy = await createTestDatabase({ legacy: true });
    try {
      const old = await legacy.query<{ a: any }>(
        "select public.create_appointment($1,$2,$3) a",
        [crypto.randomUUID(), token, body()],
      );
      const a = old.rows[0].a;
      const before = await legacy.query("select * from public.appointments");
      const upgrade = migrationFiles().find((f) =>
        f.name.startsWith("20261027"),
      )!;
      await legacy.exec(upgrade.sql);
      expect(
        (await legacy.query("select * from public.appointments")).rows,
      ).toEqual(before.rows);
      const after = await legacy.query<{ a: any }>(
        "select public.booking_gateway_execute('read',$1) a",
        [{ p_id: a.id, p_manage_token: token }],
      );
      expect(after.rows[0].a.id).toBe(a.id);
      expect(
        (
          await legacy.query<{ n: number }>(
            "select count(*)::int n from private.admin_users",
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await legacy.close();
    }
  }, 60000);
});
