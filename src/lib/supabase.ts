import { createClient } from "@supabase/supabase-js";
import { readBackendConfig } from "./backendConfig";
const config = readBackendConfig(import.meta.env);
export const isSupabase = config.mode === "supabase";
export const supabase = isSupabase
  ? createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        storage:
          typeof window !== "undefined" ? window.sessionStorage : undefined,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "aura-admin-auth",
      },
    })
  : null;
export function requireSupabase() {
  if (!supabase) throw new Error("Supabase не настроен.");
  return supabase;
}
