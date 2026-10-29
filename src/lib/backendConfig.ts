export type DataSource = "demo" | "supabase";
export interface BackendConfig {
  mode: DataSource;
  url: string;
  publishableKey: string;
}
export function readBackendConfig(
  env: Record<string, string | undefined>,
): BackendConfig {
  const url = env.VITE_SUPABASE_URL?.trim() || "";
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  const mode =
    env.VITE_DATA_SOURCE || (url || publishableKey ? "supabase" : "demo");
  if (mode !== "demo" && mode !== "supabase")
    throw new Error("VITE_DATA_SOURCE: допустимы только demo или supabase.");
  for (const [key, value] of Object.entries(env)) {
    if (
      key.startsWith("VITE_") &&
      value &&
      (/SECRET|SERVICE_ROLE|PASSWORD|DATABASE_URL/i.test(key) ||
        value.startsWith("sb_secret_"))
    ) {
      throw new Error(
        "Секретная переменная обнаружена среди VITE_*. Удалите её из клиентского окружения; значение скрыто.",
      );
    }
  }
  if (
    publishableKey &&
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
  ) {
    throw new Error(
      "Для браузера нужен только publishable key формата sb_publishable_… . Значение скрыто.",
    );
  }
  if (mode === "supabase") {
    let validUrl = false;
    try {
      const parsed = new URL(url);
      validUrl =
        (parsed.protocol === "https:" ||
          (parsed.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(parsed.hostname))) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        parsed.pathname === "/";
    } catch {
      /* fail closed */
    }
    if (!validUrl || url.includes("YOUR_PROJECT") || !publishableKey)
      throw new Error(
        "Supabase не настроен. Заполните VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в .env.local по SUPABASE_SETUP.md.",
      );
  }
  return { mode, url, publishableKey };
}
