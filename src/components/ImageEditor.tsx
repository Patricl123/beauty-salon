import { useEffect, useId, useState, type ReactNode } from "react";
import { imageSource, type ImageDraft } from "../lib/siteContent";
import { SafeImage } from "./SiteImage";

export function ImageEditor({
  value,
  onChange,
  ratio = 3 / 4,
  disabled = false,
  label = "Фотография",
  overlay,
}: {
  value: ImageDraft;
  onChange: (value: ImageDraft) => void;
  ratio?: number;
  disabled?: boolean;
  label?: string;
  overlay?: ReactNode;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [cropEnabled, setCropEnabled] = useState(!!value.crop);
  const [zoom, setZoom] = useState(1),
    [x, setX] = useState(0.5),
    [y, setY] = useState(0.5);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!value.file) {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(value.file);
    setUrl(objectUrl);
    const img = new Image();
    let alive = true;
    img.onload = () => {
      if (alive)
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (alive)
        setError("Браузер не смог открыть изображение. Выберите другой файл.");
    };
    img.src = objectUrl;
    return () => {
      alive = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [value.file]);
  const changeCrop = (enabled: boolean, z: number, px: number, py: number) => {
    setCropEnabled(enabled);
    setZoom(z);
    setX(px);
    setY(py);
    const sourceRatio = dimensions.width / dimensions.height;
    const width = Math.min(1, ratio / sourceRatio) / z,
      height = Math.min(1, sourceRatio / ratio) / z;
    onChange({
      ...value,
      crop: enabled
        ? { x: (1 - width) * px, y: (1 - height) * py, width, height }
        : undefined,
    });
  };
  const hasImage = !!(value.file || value.assetId || value.legacySrc);
  const crop = value.file ? value.crop : undefined;
  return (
    <fieldset className="image-editor" disabled={disabled}>
      <legend>{label}</legend>
      <div className="image-editor-preview" style={{ aspectRatio: ratio }}>
        <SafeImage
          draggable={false}
          src={url || value.previewUrl || imageSource(value)}
          alt={value.alt || "Предпросмотр изображения"}
          style={
            crop
              ? {
                  position: "absolute",
                  width: `${100 / crop.width}%`,
                  height: `${100 / crop.height}%`,
                  maxWidth: "none",
                  left: `${(-crop.x / crop.width) * 100}%`,
                  top: `${(-crop.y / crop.height) * 100}%`,
                }
              : { objectFit: ratio === 1 ? "contain" : "cover" }
          }
        />
        {overlay && <div className="image-editor-overlay">{overlay}</div>}
      </div>
      <label htmlFor={id} className="image-file-label">
        {hasImage ? "Выбрать другое изображение" : "Выбрать изображение"}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("Разрешены только JPEG, PNG и WebP.");
            return;
          }
          if (file.size > 10 * 1024 * 1024) {
            setError("Максимальный размер файла — 10 МБ.");
            return;
          }
          if (
            hasImage &&
            !window.confirm(
              "Заменить изображение в черновике? На сайте оно изменится только после сохранения.",
            )
          )
            return;
          setError("");
          setDimensions({ width: 0, height: 0 });
          setCropEnabled(false);
          setZoom(1);
          setX(0.5);
          setY(0.5);
          onChange({
            ...value,
            file,
            crop: undefined,
            assetId: null,
            legacySrc: "",
            previewUrl: undefined,
          });
        }}
      />
      <p className="subtle image-help">
        JPEG, PNG, WebP · до 10 МБ · до 6000 px и 12,5 Мп. Фото с телефона лучше
        выбирать в обычном размере.
      </p>
      {!!value.file && dimensions.width > 0 && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={cropEnabled}
              onChange={(e) => changeCrop(e.target.checked, zoom, x, y)}
            />
            Обрезать под пропорции блока
          </label>
          {cropEnabled && (
            <div className="crop-controls">
              <label>
                Масштаб
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) =>
                    changeCrop(true, Number(e.target.value), x, y)
                  }
                />
              </label>
              <label>
                По горизонтали
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={x}
                  onChange={(e) =>
                    changeCrop(true, zoom, Number(e.target.value), y)
                  }
                />
              </label>
              <label>
                По вертикали
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={y}
                  onChange={(e) =>
                    changeCrop(true, zoom, x, Number(e.target.value))
                  }
                />
              </label>
            </div>
          )}
        </>
      )}
      <label>
        Альтернативный текст
        <input
          maxLength={300}
          value={value.alt}
          placeholder="Кратко опишите, что изображено"
          onChange={(e) => onChange({ ...value, alt: e.target.value })}
        />
      </label>
      {hasImage && (
        <button
          type="button"
          className="text-link danger-text"
          onClick={() => {
            if (
              window.confirm(
                "Убрать изображение? Изменение появится на сайте после сохранения.",
              )
            ) {
              setError("");
              onChange({ assetId: null, legacySrc: "", alt: "" });
            }
          }}
        >
          Убрать изображение
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
