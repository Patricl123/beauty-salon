import { useEffect, useRef, useState } from "react";
interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let scriptPromise: Promise<TurnstileApi> | undefined;
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise)
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error("unavailable"));
      }, 12000);
      script.onload = () => {
        clearTimeout(timeout);
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error("unavailable"));
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("unavailable"));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = undefined;
      throw error;
    });
  return scriptPromise;
}
export function Turnstile({
  onToken,
  attempt,
}: {
  onToken: (token: string) => void;
  attempt: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    onToken("");
    setError("");
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!sitekey || sitekey.startsWith("YOUR_")) {
      setError(
        "Онлайн-запись временно недоступна: проверка защиты ещё не настроена.",
      );
      return;
    }
    void loadScript()
      .then((loaded) => {
        if (!alive || !container.current) return;
        api = loaded;
        const failed = () => {
          if (alive) {
            onToken("");
            setError("Повторите проверку защиты от ботов.");
          }
        };
        widget = api.render(container.current, {
          sitekey,
          action: "salon_booking",
          theme: "light",
          size: "flexible",
          language: "ru",
          "response-field": false,
          callback: (token: string) => {
            if (alive) {
              onToken(token);
              setError("");
            }
          },
          "expired-callback": failed,
          "error-callback": failed,
          "timeout-callback": failed,
        });
      })
      .catch(() => {
        if (alive)
          setError(
            "Не удалось загрузить проверку. Проверьте соединение и повторите.",
          );
      });
    return () => {
      alive = false;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [onToken, attempt, retry]);
  return (
    <div aria-label="Защита от ботов">
      <div ref={container} />
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить проверку
          </button>
        </p>
      )}
    </div>
  );
}
