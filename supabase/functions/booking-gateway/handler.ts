export type Operation =
  "create" | "read" | "move" | "cancel" | "slots" | "next";
export interface RpcResult {
  data: unknown;
  error?: { code?: string; message?: string } | null;
}
export interface Dependencies {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  fetch: typeof fetch;
  secret: string;
  hostnames: string[];
  origins: string[];
}
const fields: Record<Operation, string[]> = {
  create: ["p_request_id", "p_manage_token", "p_payload"],
  read: ["p_id", "p_manage_token"],
  move: [
    "p_id",
    "p_manage_token",
    "p_request_id",
    "p_expected_version",
    "p_payload",
  ],
  cancel: ["p_id", "p_manage_token", "p_request_id", "p_expected_version"],
  slots: [
    "p_service_id",
    "p_master_id",
    "p_date",
    "p_exclude_id",
    "p_manage_token",
  ],
  next: [
    "p_service_id",
    "p_master_id",
    "p_from",
    "p_exclude_id",
    "p_manage_token",
  ],
};
const knownErrors = new Set([
  "SLOT_UNAVAILABLE",
  "QUOTE_CHANGED",
  "BOOKING_CHANGED",
  "BOOKING_NOT_EDITABLE",
  "BOOKING_NOT_FOUND_OR_FORBIDDEN",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_CONTACTS",
  "CONSENT_REQUIRED",
  "SERVICE_UNAVAILABLE",
  "TIME_OUT_OF_RANGE",
  "INVALID_TIME",
  "INVALID_MANAGEMENT_TOKEN",
  "REQUEST_ID_REQUIRED",
  "ADMIN_REQUIRED",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function boundedJson(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("INVALID_REQUEST");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
    };
    if (origin && deps.origins.includes(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    const fail = (status: number, code: string, retryAfter?: number) => {
      if (retryAfter) headers["Retry-After"] = String(retryAfter);
      return new Response(
        JSON.stringify({
          error: { code, message: code, ...(retryAfter ? { retryAfter } : {}) },
        }),
        { status, headers },
      );
    };
    if (origin && !deps.origins.includes(origin))
      return fail(403, "ORIGIN_DENIED");
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    if (!deps.secret || !deps.hostnames.length || !deps.origins.length)
      return fail(503, "PROTECTION_UNAVAILABLE");
    if (!req.headers.get("Content-Type")?.includes("application/json"))
      return fail(400, "INVALID_REQUEST");
    let body: {
      operation: Operation;
      args: Record<string, unknown>;
      captchaToken?: string;
    };
    try {
      const parsed = (await boundedJson(req)) as typeof body;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Object.hasOwn(fields, parsed.operation) ||
        !parsed.args ||
        typeof parsed.args !== "object" ||
        Array.isArray(parsed.args) ||
        Object.keys(parsed.args).some(
          (key) => !fields[parsed.operation].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      body = parsed;
    } catch {
      return fail(400, "INVALID_REQUEST");
    }
    const { operation, args } = body;
    const target = args.p_id ?? args.p_exclude_id;
    const phone = (args.p_payload as Record<string, unknown> | undefined)
      ?.phone;
    try {
      // Independent DB transaction: rejected CAPTCHA, invalid codes and rolled-back writes still count.
      // Deliberately ignore X-Forwarded-For, CF-Connecting-IP, X-Real-IP and all claimed user identities.
      const quota = await deps.rpc("booking_gateway_limit", {
        p_operation: operation,
        p_target:
          typeof target === "string" && uuid.test(target) ? target : null,
        p_phone:
          typeof phone === "string" && /^\+996[0-9]{9}$/.test(phone)
            ? phone
            : null,
      });
      const limits = quota.data as {
        allowed?: boolean;
        retryAfter?: number;
      } | null;
      if (quota.error || !limits || typeof limits.allowed !== "boolean")
        return fail(503, "PROTECTION_UNAVAILABLE");
      if (!limits.allowed)
        return fail(
          429,
          "RATE_LIMITED",
          Math.max(1, Math.min(86400, Number(limits.retryAfter) || 60)),
        );
      if (operation === "create") {
        if (
          typeof body.captchaToken !== "string" ||
          !body.captchaToken ||
          body.captchaToken.length > 2048
        )
          return fail(400, "CAPTCHA_REQUIRED");
        let verdict: {
          success?: boolean;
          hostname?: string;
          action?: string;
          challenge_ts?: string;
        };
        try {
          const response = await deps.fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                secret: deps.secret,
                response: body.captchaToken,
                idempotency_key: crypto.randomUUID(),
              }),
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!response.ok) return fail(503, "PROTECTION_UNAVAILABLE");
          verdict = await response.json();
        } catch {
          return fail(503, "PROTECTION_UNAVAILABLE");
        }
        const age = Date.now() - Date.parse(verdict.challenge_ts || "");
        if (
          verdict.success !== true ||
          verdict.action !== "salon_booking" ||
          !deps.hostnames.includes((verdict.hostname || "").toLowerCase()) ||
          !Number.isFinite(age) ||
          age < -60000 ||
          age > 300000
        )
          return fail(400, "CAPTCHA_REJECTED");
      }
      const result = await deps.rpc("booking_gateway_execute", {
        p_operation: operation,
        p_args: args,
      });
      if (result.error) {
        const { code, message } = result.error;
        if (code === "23P01") return fail(409, "SLOT_UNAVAILABLE");
        if (knownErrors.has(message || ""))
          return fail(code === "42501" ? 403 : 409, message!);
        if (code?.startsWith("22") || code?.startsWith("23"))
          return fail(400, "INVALID_REQUEST");
        // Never return SQL details, contact data, capability values or external provider errors.
        return fail(503, "PROTECTION_UNAVAILABLE");
      }
      return new Response(JSON.stringify({ data: result.data }), {
        status: 200,
        headers,
      });
    } catch {
      // Network results can be ambiguous; the client retains its original idempotency key.
      return fail(503, "PROTECTION_UNAVAILABLE");
    }
  };
}
