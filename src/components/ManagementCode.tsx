import { useState } from "react";
import { managementCode } from "../lib/guestAccess";
export function ManagementCode({ id }: { id: string }) {
  const code = managementCode(id);
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <details className="privacy-details">
      <summary>Код для переноса и отмены</summary>
      <p>
        Сохраните код в безопасном месте. Он даёт доступ к этой записи. После
        закрытия вкладки код понадобится для раздела «Мои записи».
      </p>
      <label>
        Персональный код
        <input
          readOnly
          value={code}
          onFocus={(e) => e.target.select()}
          autoComplete="off"
        />
      </label>
      <button
        className="button button-light"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Скопировано" : "Скопировать код"}
      </button>
    </details>
  );
}
