import { categories } from "../i18n";
import type { ServicesBlock, SiteContent } from "../lib/siteContent";
import { cleanImage } from "../lib/siteContent";
import { ImageEditor } from "./ImageEditor";

export function ServicesBlockEditor({
  content,
  onChange,
  onSave,
  canSave,
}: {
  content: SiteContent;
  onChange: (content: SiteContent) => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const block = content.servicesBlock;
  if (!block)
    return (
      <section className="admin-panel content-section">
        <h2>Блок услуг</h2>
        <p>
          Для редактирования блока примените миграцию
          202610310010_service_content.sql и загрузите актуальную версию
          контента.
        </p>
      </section>
    );
  const setText = (key: keyof ServicesBlock, value: string) =>
    onChange({ ...content, servicesBlock: { ...block, [key]: value } });
  return (
    <section className="admin-panel content-section services-block-editor">
      <h2>Блок услуг</h2>
      <p className="subtle">
        Названия, цены и длительность услуг меняются в разделе «Услуги».
        Категории без активных услуг скрываются только на сайте; их оформление
        сохраняется.
      </p>
      <div className="form-grid">
        {(
          [
            ["eyebrow", "Надзаголовок"],
            ["headingBefore", "Заголовок — до курсива"],
            ["headingEmphasis", "Заголовок — курсив"],
            ["headingAfter", "Заголовок — после курсива"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              maxLength={160}
              value={block[key]}
              onChange={(e) => setText(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <label>
        <span id="services-description-label">Описание блока</span>
        <textarea
          aria-labelledby="services-description-label"
          rows={3}
          maxLength={1000}
          value={block.description}
          onChange={(e) => setText("description", e.target.value)}
        />
      </label>
      <label>
        <span id="services-footnote-label">Примечание под услугами</span>
        <textarea
          aria-labelledby="services-footnote-label"
          rows={2}
          maxLength={500}
          value={block.footnote}
          onChange={(e) => setText("footnote", e.target.value)}
        />
      </label>
      <div
        className="services-heading-preview"
        aria-label="Предпросмотр заголовка блока услуг"
      >
        <div className="eyebrow">{block.eyebrow}</div>
        <h2>
          {block.headingBefore} <em>{block.headingEmphasis}</em>{" "}
          {block.headingAfter}
        </h2>
        <p style={{ whiteSpace: "pre-line" }}>{block.description}</p>
        <p className="service-footnote">{block.footnote}</p>
      </div>
      <div className="content-image-grid">
        {Object.entries(categories).map(([id, label]) => {
          const row = content.items.find(
            (i) => i.kind === "service_category" && i.category === id,
          );
          if (!row)
            return (
              <p role="alert" key={id}>
                Не удалось загрузить оформление категории «{label}». Загрузите
                актуальную версию.
              </p>
            );
          const edit = (patch: Partial<typeof row>) =>
            onChange({
              ...content,
              items: content.items.map((i) =>
                i.id === row.id ? { ...i, ...patch } : i,
              ),
            });
          return (
            <article
              className="content-image-card"
              key={id}
              data-service-category={id}
            >
              <h3>{label}</h3>
              <ImageEditor
                label={`Фото категории «${label}»`}
                ratio={3 / 4}
                value={row}
                onChange={(value) =>
                  onChange({
                    ...content,
                    items: content.items.map((i) =>
                      i.id === row.id ? { ...cleanImage(i), ...value } : i,
                    ),
                  })
                }
                overlay={
                  <>
                    <span>{row.caption}</span>
                    <p>{row.title}</p>
                  </>
                }
              />
              <label>
                Подпись над заголовком
                <input
                  maxLength={160}
                  value={row.caption}
                  onChange={(e) => edit({ caption: e.target.value })}
                />
              </label>
              <label>
                Заголовок поверх фото
                <input
                  maxLength={160}
                  value={row.title || ""}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="button button-dark"
        disabled={!canSave}
        onClick={onSave}
      >
        Сохранить блок услуг
      </button>
    </section>
  );
}
