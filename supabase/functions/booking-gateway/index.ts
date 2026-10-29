import { createHandler, type RpcResult } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL") || "";
// Injected by Supabase into the server runtime. Never exposed to Vite/the browser.
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const list = (name: string) =>
  (Deno.env.get(name) || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
Deno.serve(
  createHandler({
    secret: Deno.env.get("TURNSTILE_SECRET_KEY") || "",
    hostnames: list("TURNSTILE_ALLOWED_HOSTNAMES").map((v) => v.toLowerCase()),
    origins: list("BOOKING_ALLOWED_ORIGINS"),
    fetch,
    rpc: async (name, args): Promise<RpcResult> => {
      if (!url || !key) return { data: null, error: { code: "UNAVAILABLE" } };
      const response = await fetch(url + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      return response.ok
        ? { data: result }
        : { data: null, error: { code: result.code, message: result.message } };
    },
  }),
);
