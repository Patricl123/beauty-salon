import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  LoaderCircle,
} from "lucide-react";
import { isSupabase, requireSupabase } from "../lib/supabase";
import {
  cleanImage,
  initialContent,
  mediaError,
  mediaRequest,
  previewImages,
  stageImage,
  useSiteContent,
  type SiteContent,
  type SiteImage,
} from "../lib/siteContent";
import { ImageEditor } from "./ImageEditor";

export function SiteContentAdmin({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const { refresh } = useSiteContent();
  const [draft, setDraft] = useState<SiteContent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const dragged = useRef<string | null>(null);
  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("Загрузка контента…");
    setError("");
    try {
      const { data, error: problem } = await requireSupabase().rpc(
        "get_site_content_admin",
      );
      if (problem) throw problem;
      const content = data as SiteContent;
      const previews = await previewImages(
        content.items.flatMap((i) => (i.assetId ? [i.assetId] : [])),
      );
      setDraft({
        ...content,
        items: content.items.map((i) => ({
          ...i,
          previewUrl: i.assetId ? previews[i.assetId] : undefined,
        })),
      });
      setDirty(false);
    } catch (e) {
      setError(mediaError(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  useEffect(() => {
    if (isSupabase) void load();
    else setDraft(structuredClone(initialContent));
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const edit = (items: SiteImage[]) => {
    const ordered = new Map(
      ["hero", "logo", "salon", "portfolio"].map((kind) => [
        kind,
        items
          .filter((i) => i.kind === kind)
          .sort((a, b) => a.position - b.position)
          .map((i) => i.id),
      ]),
    );
    setDraft((d) =>
      d
        ? {
            ...d,
            items: items.map((i) => ({
              ...i,
              position: ordered.get(i.kind)!.indexOf(i.id),
            })),
          }
        : d,
    );
    setDirty(true);
    setError("");
  };
  const save = async () => {
    if (!draft || lock.current) return;
    lock.current = true;
    setError("");
    setBusy("Проверка и загрузка изображений…");
    const items = [...draft.items];
    try {
      // Sequential processing bounds Edge memory and lets already completed stages be retried.
      for (let index = 0; index < items.length; index++)
        if (items[index].file) {
          setBusy(
            `Проверка и загрузка: ${items[index].caption || items[index].alt || "изображение"}…`,
          );
          items[index] = {
            ...cleanImage(items[index]),
            ...(await stageImage(items[index])),
          };
          setDraft({ ...draft, items: [...items] });
        }
      setBusy("Сохранение изменений…");
      const { data, error: problem } = await requireSupabase().rpc(
        "save_site_content",
        { p_items: items.map(cleanImage), p_expected_revision: draft.revision },
      );
      if (problem) throw problem;
      setDraft({
        ...data,
        items: (data as SiteContent).items.map((i) => ({
          ...i,
          previewUrl: items.find((old) => old.id === i.id)?.previewUrl,
        })),
      });
      setDirty(false);
      await refresh();
      onMessage("Контент сохранён. Изображения доступны посетителям.");
      // Best effort only; a cleanup failure must not turn a committed save into an error.
      void mediaRequest("cleanup").catch(() => {});
    } catch (e) {
      setError(mediaError(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const add = (kind: "salon" | "portfolio") => {
    if (!draft) return;
    edit([
      ...draft.items,
      {
        id: `${kind}:${crypto.randomUUID()}`,
        kind,
        assetId: null,
        legacySrc: "",
        alt: "",
        caption: "",
        category: "",
        visible: true,
        position: draft.items.filter((i) => i.kind === kind).length,
      },
    ]);
  };
  const move = (row: SiteImage, direction: number) => {
    if (!draft) return;
    const group = draft.items
      .filter((i) => i.kind === row.kind)
      .sort((a, b) => a.position - b.position);
    const from = group.findIndex((i) => i.id === row.id),
      to = from + direction;
    if (to < 0 || to >= group.length) return;
    group.splice(to, 0, ...group.splice(from, 1));
    edit(
      draft.items.map((i) =>
        i.kind === row.kind
          ? { ...i, position: group.findIndex((x) => x.id === i.id) }
          : i,
      ),
    );
  };
  return (
    <div className="site-content-admin">
      <p className="notice">
        Изменения появятся на сайте после нажатия «Сохранить контент».
        Фотографии мастеров меняются в разделе «Мастера», внутри профиля.
      </p>
      {!isSupabase && (
        <p className="warning">
          Загрузка работает в подключённом Supabase. В деморежиме доступен
          только просмотр этого раздела.
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <p className="media-progress" role="status">
          <LoaderCircle className="spin" size={18} />
          {busy}
        </p>
      )}
      <div className="content-actions">
        <button
          className="button button-dark"
          disabled={!isSupabase || !!busy || !dirty}
          onClick={() => void save()}
        >
          Сохранить контент
        </button>
        <button
          className="button button-light"
          disabled={!isSupabase || !!busy}
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                "Отменить несохранённые изменения и загрузить актуальный контент?",
              )
            )
              void load();
          }}
        >
          Загрузить актуальную версию
        </button>
      </div>
      <fieldset disabled={!isSupabase || !!busy} className="content-fields">
        {(
          [
            ["hero", "Главное фото"],
            ["logo", "Логотип"],
            ["salon", "Фотографии салона"],
            ["portfolio", "Портфолио работ"],
          ] as const
        ).map(([kind, title]) => {
          const group = (
            draft?.items.filter((i) => i.kind === kind) || []
          ).sort((a, b) => a.position - b.position);
          return (
            <section className="admin-panel content-section" key={kind}>
              <div className="panel-heading">
                <h2>{title}</h2>
                {(kind === "salon" || kind === "portfolio") && (
                  <button
                    type="button"
                    className="button button-light"
                    disabled={(draft?.items.length || 0) >= 100}
                    onClick={() => add(kind)}
                  >
                    <Plus size={16} />
                    Добавить фото
                  </button>
                )}
              </div>
              {kind === "salon" && (
                <p className="subtle content-section-note">
                  Показываются в существующем блоке «О салоне». Несколько
                  снимков можно переключать кнопками.
                </p>
              )}
              {kind === "portfolio" && <p className="subtle content-section-note">Загружайте фотографии настоящих работ салона. Отметка «Показывать на сайте» публикует загруженное фото после сохранения. Стартовые иллюстрации видны только здесь; для публикации замените их своим файлом.</p>}
              <div className="content-image-grid">
                {group.map((row, index) => (
                  <article
                    className="content-image-card"
                    key={row.id}
                    onDragOver={(e) => {
                      if (
                        !busy &&
                        dragged.current &&
                        group.some((i) => i.id === dragged.current)
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const source = group.find(
                        (i) => i.id === dragged.current,
                      );
                      if (!busy && source && source.id !== row.id) {
                        e.preventDefault();
                        move(source, index - group.indexOf(source));
                      }
                      dragged.current = null;
                    }}
                  >
                    {(kind === "salon" || kind === "portfolio") && (
                      <button
                        type="button"
                        className="content-drag-handle"
                        draggable={!busy && isSupabase}
                        aria-label={`Перетащить фото ${index + 1}`}
                        title="Перетащите на другое фото или используйте кнопки «Выше» и «Ниже»"
                        onDragStart={(e) => {
                          dragged.current = row.id;
                          e.dataTransfer.setData("text/plain", row.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          dragged.current = null;
                        }}
                      >
                        <GripVertical size={16} />
                        Перетащить
                      </button>
                    )}
                    <ImageEditor
                      label={
                        kind === "hero"
                          ? "Главное фото"
                          : kind === "logo"
                            ? "Логотип"
                            : `Фото ${index + 1}`
                      }
                      value={row}
                      ratio={
                        kind === "logo" ? 1 : kind === "hero" ? 4 / 5 : 3 / 4
                      }
                      onChange={(value) =>
                        edit(
                          draft!.items.map((i) =>
                            i.id === row.id
                              ? { ...cleanImage(i), ...value }
                              : i,
                          ),
                        )
                      }
                    />
                    {kind === "portfolio" && !row.assetId && !row.file && row.legacySrc && <p className="demo-label">Стартовая иллюстрация · только в админке</p>}
                    {kind === "portfolio" && (
                      <>
                        <label>
                          Подпись
                          <input
                            maxLength={160}
                            value={row.caption}
                            onChange={(e) =>
                              edit(
                                draft!.items.map((i) =>
                                  i.id === row.id
                                    ? { ...i, caption: e.target.value }
                                    : i,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Категория
                          <input
                            maxLength={80}
                            value={row.category}
                            placeholder="Например, маникюр"
                            onChange={(e) =>
                              edit(
                                draft!.items.map((i) =>
                                  i.id === row.id
                                    ? { ...i, category: e.target.value }
                                    : i,
                                ),
                              )
                            }
                          />
                        </label>
                      </>
                    )}
                    {(kind === "salon" || kind === "portfolio") && (
                      <>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={row.visible}
                            onChange={(e) =>
                              edit(
                                draft!.items.map((i) =>
                                  i.id === row.id
                                    ? { ...i, visible: e.target.checked }
                                    : i,
                                ),
                              )
                            }
                          />
                          Показывать на сайте
                        </label>
                        <div className="content-item-actions">
                          <button
                            type="button"
                            className="button button-light"
                            aria-label={`Переместить фото ${index + 1} выше`}
                            disabled={index === 0}
                            onClick={() => move(row, -1)}
                          >
                            <ArrowUp size={16} />
                            Выше
                          </button>
                          <button
                            type="button"
                            className="button button-light"
                            aria-label={`Переместить фото ${index + 1} ниже`}
                            disabled={index === group.length - 1}
                            onClick={() => move(row, 1)}
                          >
                            <ArrowDown size={16} />
                            Ниже
                          </button>
                          <button
                            type="button"
                            className="text-link danger-text"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Удалить этот элемент после сохранения контента?",
                                )
                              )
                                edit(
                                  draft!.items.filter((i) => i.id !== row.id),
                                );
                            }}
                          >
                            Удалить элемент
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
              {!group.length && (
                <p className="content-section-note subtle">
                  Фотографий пока нет.
                </p>
              )}
            </section>
          );
        })}
      </fieldset>
    </div>
  );
}
