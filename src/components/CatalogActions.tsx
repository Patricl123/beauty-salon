import { useState } from "react";
import type {
  CatalogAction,
  CatalogImpact,
  CatalogKind,
  Master,
  Service,
} from "../types";
import { useStore } from "../lib/store";
import { rpc } from "../lib/cloudRepository";
import { catalogImpact } from "../lib/catalog";
import { isSupabase } from "../lib/supabase";
import { apiError } from "../lib/apiErrors";
import { mediaRequest } from "../lib/siteContent";
import { Modal } from "./UI";

export function CatalogActions({
  kind,
  item,
  onMessage,
}: {
  kind: CatalogKind;
  item: Master | Service;
  onMessage: (message: string) => void;
}) {
  const { data, catalogAction, saving } = useStore();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<CatalogImpact | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inspect = async () => {
    setImpact(null);
    try {
      setImpact(
        isSupabase
          ? await rpc<CatalogImpact>("admin_catalog_impact", {
              p_kind: kind,
              p_id: item.id,
            })
          : catalogImpact(data, kind, item.id),
      );
    } catch (e) {
      setError(apiError(e));
    }
  };
  const show = async () => {
    setOpen(true);
    setError("");
    setBusy(true);
    await inspect();
    setBusy(false);
  };
  const execute = async (action: CatalogAction) => {
    if (!impact || busy || saving) return;
    setBusy(true);
    setError("");
    const failure = await catalogAction(kind, item.id, action, impact.revision);
    if (failure) {
      setError(failure);
      await inspect();
    } else {
      setOpen(false);
      onMessage(
        action === "delete"
          ? "Удалено. Связанных записей нет."
          : action === "archive"
            ? "Перенесено в архив. История и фотографии сохранены."
            : "Восстановлено из архива. Настройки сохранены.",
      );
      if (isSupabase && action === "delete")
        void mediaRequest("cleanup").catch(() => {});
    }
    setBusy(false);
  };
  return (
    <>
      <button
        className="text-link"
        disabled={saving || busy}
        onClick={() => void show()}
      >
        {item.archived ? "Восстановить" : "Удалить"}
      </button>
      {open && (
        <Modal
          title={`${item.archived ? "Восстановление" : "Удаление"}: ${item.name}`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div aria-busy={busy}>
            {busy && <p role="status">Проверка и сохранение…</p>}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {impact && (
              <>
                {impact.archived ? (
                  <p>
                    Восстановить объект с прежними фотографиями, услугами и
                    настройками? Скрытая ранее услуга останется скрытой до
                    включения активности.
                  </p>
                ) : impact.future > 0 ? (
                  <p role="alert">
                    Предстоящих или текущих неотменённых записей:{" "}
                    <strong>{impact.future}</strong>. Сначала перенесите или
                    отмените их в разделе «Записи». Автоматической отмены не
                    будет.
                  </p>
                ) : impact.total > 0 ? (
                  <p>
                    Связанных записей: <strong>{impact.total}</strong>. Полное
                    удаление недоступно. Перенести в архив? История и фотографии
                    сохранятся; новые бронирования будут запрещены.
                  </p>
                ) : (
                  <p>
                    Связанных записей нет. Удалить без возможности
                    восстановления? Привязки услуг и блокировки времени будут
                    убраны. Можно вместо удаления сохранить объект в архиве.
                  </p>
                )}
                <div className="catalog-actions">
                  {impact.archived ? (
                    <button
                      className="button button-dark"
                      disabled={busy || saving}
                      onClick={() => void execute("restore")}
                    >
                      Подтвердить восстановление
                    </button>
                  ) : (
                    impact.future === 0 && (
                      <>
                        {impact.total === 0 && (
                          <button
                            className="button button-dark"
                            disabled={busy || saving}
                            onClick={() => void execute("delete")}
                          >
                            Подтвердить удаление
                          </button>
                        )}
                        <button
                          className="button button-light"
                          disabled={busy || saving}
                          onClick={() => void execute("archive")}
                        >
                          В архив
                        </button>
                      </>
                    )
                  )}
                </div>
              </>
            )}
            <button
              className="text-link"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ArchiveFilter({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="segmented" aria-label="Фильтр архива">
      <button
        className={!archived ? "active" : ""}
        aria-pressed={!archived}
        onClick={() => onChange(false)}
      >
        Текущие
      </button>
      <button
        className={archived ? "active" : ""}
        aria-pressed={archived}
        onClick={() => onChange(true)}
      >
        Архив
      </button>
    </div>
  );
}
