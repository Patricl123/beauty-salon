// Real multi-connection PostgreSQL test. Requires an explicitly disposable, empty database.
// It never prints connection strings, tokens, passwords, SQL parameters or real client data.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
const url = process.env.TEST_DATABASE_URL;
if (!url || process.env.AURA_ALLOW_DISPOSABLE_DB_TEST !== "yes") {
  console.error(
    "Not run. Set TEST_DATABASE_URL for an EMPTY disposable PostgreSQL database and AURA_ALLOW_DISPOSABLE_DB_TEST=yes. Never use production.",
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 6 });
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const existing = await pool.query(
    "select table_schema,table_name from information_schema.tables where table_schema in ('public','private','auth') and table_type='BASE TABLE'",
  );
  check(existing.rowCount === 0, "Database is not empty; refusing to run.");
  await pool.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$; grant usage on schema public to service_role;
    create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(readFileSync("supabase/migrations/" + file, "utf8"));
  await pool.query(readFileSync("supabase/seed.sql", "utf8"));
  await pool.query("update public.masters set days=array[0,1,2,3,4,5,6]");
  const result = await pool.query(
    "select ((now() at time zone 'Asia/Bishkek')::date+2)::text as day",
  );
  const body = {
    serviceId: "haircut",
    masterId: "aida",
    date: result.rows[0].day,
    time: "10:00",
    clientName: "Concurrency test",
    phone: "+996000000001",
    comment: "Disposable test",
    expectedPrice: 2200,
    expectedDuration: 60,
    consent: true,
    owner: "visitor",
  };
  async function call(sql, params) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      // The business-race test calls the same private core as the protected gateway.
      // CAPTCHA/HTTP behavior is tested separately; this script has no public bypass.
      const operation = sql.includes("create_appointment")
        ? "create"
        : sql.includes("reschedule_appointment")
          ? "move"
          : "cancel";
      const fields =
        operation === "create"
          ? ["p_request_id", "p_manage_token", "p_payload"]
          : operation === "move"
            ? [
                "p_id",
                "p_manage_token",
                "p_request_id",
                "p_expected_version",
                "p_payload",
              ]
            : ["p_id", "p_manage_token", "p_request_id", "p_expected_version"];
      const r = await client.query(
        "select public.booking_gateway_execute($1,$2) as result",
        [
          operation,
          Object.fromEntries(fields.map((field, i) => [field, params[i]])),
        ],
      );
      await client.query("commit");
      return r.rows[0].result;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  const secrets = [
    randomBytes(32).toString("hex"),
    randomBytes(32).toString("hex"),
  ];
  const createSQL = "select public.create_appointment($1,$2,$3) as result";
  const rivals = await Promise.allSettled(
    secrets.map((token) => call(createSQL, [randomUUID(), token, body])),
  );
  check(
    rivals.filter((r) => r.status === "fulfilled").length === 1,
    "Concurrent overlapping creates must have exactly one winner.",
  );
  const loser = rivals.find((r) => r.status === "rejected");
  check(
    loser.reason.code === "23P01",
    "Loser must receive an overlap conflict.",
  );
  const firstIndex = rivals.findIndex((r) => r.status === "fulfilled");
  const first = rivals[firstIndex].value;
  const repeatToken = randomBytes(32).toString("hex"),
    repeatKey = randomUUID(),
    repeatBody = { ...body, time: "14:00" };
  const duplicate = await Promise.all([
    call(createSQL, [repeatKey, repeatToken, repeatBody]),
    call(createSQL, [repeatKey, repeatToken, repeatBody]),
  ]);
  check(
    duplicate[0].id === duplicate[1].id,
    "Repeated concurrent requests must return the same id.",
  );
  const race = await Promise.allSettled([
    call("select public.reschedule_appointment($1,$2,$3,$4,$5) as result", [
      first.id,
      secrets[firstIndex],
      randomUUID(),
      1,
      { ...body, time: "17:00" },
    ]),
    call("select public.cancel_appointment($1,$2,$3,$4) as result", [
      first.id,
      secrets[firstIndex],
      randomUUID(),
      1,
    ]),
  ]);
  check(
    race.filter((r) => r.status === "fulfilled").length === 1,
    "Move/cancel race must commit exactly once for one version.",
  );
  const cancellation = [duplicate[0].id, repeatToken, randomUUID(), 1];
  const cancelled = await Promise.all([
    call(
      "select public.cancel_appointment($1,$2,$3,$4) as result",
      cancellation,
    ),
    call(
      "select public.cancel_appointment($1,$2,$3,$4) as result",
      cancellation,
    ),
  ]);
  check(
    cancelled.every((a) => a.status === "cancelled" && a.version === 2),
    "Repeated cancellation must not increment twice.",
  );
  const total = await pool.query(
    "select count(*)::integer as count from public.appointments",
  );
  check(total.rows[0].count === 2, "No duplicate appointments may exist.");
  // Thirty slots in a shared minute bucket: independent PostgreSQL connections.
  // Roll back no counters; this intentionally verifies actual contention.
  await pool.query("truncate private.booking_rate_buckets");
  async function takeQuota() {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const result = await client.query(
        "select public.booking_gateway_limit('create',null,null) as result",
      );
      await client.query("commit");
      return result.rows[0].result.allowed;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  const allowed = await Promise.all(Array.from({ length: 40 }, takeQuota));
  check(
    allowed.filter(Boolean).length === 30,
    "Shared quota must admit exactly thirty requests within a single minute. If a minute boundary occurred, retry in a fresh database.",
  );
  console.log(
    "PASS: concurrent overlap, duplicate create, move/cancel version race, duplicate cancellation, shared quota. Disposable schema remains for inspection.",
  );
} catch {
  console.error(
    "Live database test failed or the safety precondition was not met. Connection details and SQL parameters are intentionally hidden. Use only a fresh empty disposable database.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
