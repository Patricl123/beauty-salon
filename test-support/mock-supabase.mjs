// Disposable, loopback-only Supabase protocol adapter for browser integration tests.
// Real SQL and RLS run in PGlite. Auth tokens here are TEST FIXTURES, never real JWTs.
import http from "node:http";
import { readFileSync } from "node:fs";
import { initializeImageMagick } from "@imagemagick/magick-wasm";
import { createMediaHandler } from "../supabase/functions/site-media/handler.ts";
import {
  configureImageLimits,
  processImage,
} from "../supabase/functions/site-media/image.ts";
import { createTestDatabase, TEST_ADMIN_ID, TEST_USER_ID } from "./database.ts";
import { createHandler } from "../supabase/functions/booking-gateway/handler.ts";
const db = await createTestDatabase();
const calls = new Map();
const sessions = new Map();
const usedCaptcha = new Set();
const mediaFiles = new Map();
const previewTokens = new Map();
await initializeImageMagick(
  readFileSync(
    new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
  ),
);
configureImageLimits();
const media = createMediaHandler({
  origins: ["http://127.0.0.1:5175"],
  authenticate: async (token) => sessions.get(token)?.user.id || null,
  isAdmin: async (token) => {
    const user = sessions.get(token)?.user.id;
    if (!user) return false;
    const result = await db.query(
      "select exists(select 1 from private.admin_users where user_id=$1 and active) as allowed",
      [user],
    );
    return result.rows[0].allowed;
  },
  isMaintenance: () => false,
  rpc: async (name, values) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const keys = args[name];
      const result = await tx.query(
        `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
        keys.map((k) => values[k] ?? null),
      );
      return result.rows[0].result;
    }),
  process: processImage,
  upload: async (path, bytes) => {
    mediaFiles.set(path, bytes);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('site-media',$1)",
      [path],
    );
  },
  sign: async (path) => {
    const token = crypto.randomUUID();
    previewTokens.set(token, path);
    return `http://127.0.0.1:15329/__test/media?preview=${token}`;
  },
  download: async (path) =>
    mediaFiles.has(path)
      ? new Response(mediaFiles.get(path))
      : new Response(null, { status: 404 }),
  remove: async (paths) => {
    for (const path of paths) mediaFiles.delete(path);
    await db.query(
      "delete from storage.objects where name=any($1) and bucket_id='site-media'",
      [paths],
    );
  },
});
const gateway = createHandler({
  secret: "TEST_ONLY_SECRET",
  hostnames: ["127.0.0.1"],
  origins: ["http://127.0.0.1:5175"],
  fetch: async (_url, options) => {
    const value = JSON.parse(options.body);
    const valid =
      value.response.startsWith("TEST_CAPTCHA_") &&
      !usedCaptcha.has(value.response);
    usedCaptcha.add(value.response);
    return Response.json({
      success: valid,
      hostname: "127.0.0.1",
      action: "salon_booking",
      challenge_ts: new Date().toISOString(),
    });
  },
  rpc: async (name, values) => {
    try {
      const keys =
        name === "booking_gateway_limit"
          ? ["p_operation", "p_target", "p_phone"]
          : ["p_operation", "p_args"];
      const result = await db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        const result = await tx.query(
          `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          keys.map((k) => values[k] ?? null),
        );
        return result.rows[0].result;
      });
      return { data: result };
    } catch (error) {
      return {
        data: null,
        error: { code: error.code, message: error.message },
      };
    }
  },
});
const args = {
  get_site_content: [],
  get_site_content_admin: [],
  save_site_content: ["p_items", "p_expected_revision", "p_services_block"],
  media_begin_upload: ["p_actor"],
  media_finish_upload: ["p_actor", "p_id", "p_width", "p_height", "p_bytes"],
  media_asset_paths: ["p_ids", "p_actor"],
  media_gc_claim: [],
  media_gc_finish: ["p_ids"],
  is_admin: [],
  get_public_catalog: [],
  get_admin_snapshot: [],
  get_appointment: ["p_id", "p_manage_token"],
  get_available_slots: [
    "p_service_id",
    "p_master_id",
    "p_date",
    "p_exclude_id",
    "p_manage_token",
  ],
  get_next_available_slot: [
    "p_service_id",
    "p_master_id",
    "p_from",
    "p_exclude_id",
    "p_manage_token",
  ],
  create_appointment: ["p_request_id", "p_manage_token", "p_payload"],
  reschedule_appointment: [
    "p_id",
    "p_manage_token",
    "p_request_id",
    "p_expected_version",
    "p_payload",
  ],
  cancel_appointment: [
    "p_id",
    "p_manage_token",
    "p_request_id",
    "p_expected_version",
  ],
  admin_set_status: ["p_id", "p_status", "p_request_id", "p_expected_version"],
  admin_apply_changes: [
    "p_changes",
    "p_expected_revision",
    "p_allow_conflicts",
  ],
  admin_catalog_impact: ["p_kind", "p_id"],
  admin_catalog_action: ["p_kind", "p_id", "p_action", "p_expected_revision"],
};
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5175");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "authorization,apikey,content-type,x-client-info,x-supabase-api-version,content-profile,accept-profile",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  const send = (status, data) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") {
    send(204, null);
    return;
  }
  const route = new URL(req.url, "http://127.0.0.1").pathname;
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const session = sessions.get(token);
  try {
    if (route === "/functions/v1/site-media") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await media(
        new Request("http://127.0.0.1:15329" + req.url, {
          method: req.method,
          headers: req.headers,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      res.statusCode = response.status;
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (route === "/__test/media") {
      const key = new URL(req.url, "http://127.0.0.1").searchParams.get(
        "preview",
      );
      const bytes = mediaFiles.get(previewTokens.get(key));
      res.statusCode = bytes ? 200 : 404;
      res.setHeader("Content-Type", "image/webp");
      res.end(bytes ? Buffer.from(bytes) : undefined);
      return;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 200000) throw new Error("Request too large");
    }
    const body = raw ? JSON.parse(raw) : {};
    if (route === "/functions/v1/booking-gateway") {
      if (body.operation === "create")
        calls.set(
          "create_appointment",
          (calls.get("create_appointment") || 0) + 1,
        );
      const response = await gateway(
        new Request("http://127.0.0.1:15329" + route, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: req.headers.origin || "http://127.0.0.1:5175",
          },
          body: raw,
        }),
      );
      res.statusCode = response.status;
      if (response.headers.has("Retry-After"))
        res.setHeader("Retry-After", response.headers.get("Retry-After"));
      res.end(await response.text());
      return;
    }
    if (route === "/health") {
      send(200, { ok: true });
      return;
    }
    if (route === "/__test/stats") {
      const counts = await db.query(
        "select count(*)::integer as count from public.appointments",
      );
      send(200, {
        appointments: counts.rows[0].count,
        calls: Object.fromEntries(calls),
      });
      return;
    }
    if (route === "/auth/v1/token") {
      if (
        !["admin@example.test", "viewer@example.test"].includes(body.email) ||
        body.password !== "TestingOnly123!"
      ) {
        send(400, {
          code: "invalid_credentials",
          message: "Invalid credentials",
        });
        return;
      }
      const id =
        body.email === "admin@example.test" ? TEST_ADMIN_ID : TEST_USER_ID;
      const access =
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
          "base64url",
        ) +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: id,
            exp: Math.floor(Date.now() / 1000) + 3600,
            role: "authenticated",
          }),
        ).toString("base64url") +
        ".TEST_ONLY_SIGNATURE";
      const user = {
        id,
        email: body.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      const value = {
        access_token: access,
        refresh_token: "TEST_ONLY_REFRESH",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      };
      sessions.set(access, value);
      send(200, value);
      return;
    }
    if (route === "/auth/v1/logout") {
      sessions.delete(token);
      send(204, null);
      return;
    }
    if (route === "/auth/v1/user") {
      send(session ? 200 : 401, session?.user || { message: "Unauthorized" });
      return;
    }
    const name = route.split("/").pop();
    if (route.startsWith("/rest/v1/rpc/") && Object.hasOwn(args, name)) {
      calls.set(name, (calls.get(name) || 0) + 1);
      const result = await db.transaction(async (tx) => {
        await tx.exec(`set local role ${session ? "authenticated" : "anon"}`);
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          session?.user.id || "",
        ]);
        const values = args[name].map((key) => body[key] ?? null);
        const output = await tx.query(
          `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`,
          values,
        );
        return output.rows[0].result;
      });
      send(200, result);
      return;
    }
    send(404, { message: "Not found" });
  } catch (error) {
    send(error.code === "42501" ? 403 : 400, {
      code: error.code || "P0001",
      message: error.message,
      details: error.detail || null,
      hint: null,
    });
  }
});
server.listen(15329, "127.0.0.1", () =>
  console.log("Disposable SQL test API: http://127.0.0.1:15329"),
);
async function close() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
