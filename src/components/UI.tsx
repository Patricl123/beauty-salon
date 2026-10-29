import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { imageSource, useSiteContent } from "../lib/siteContent";
import { ContentImage } from "./SiteImage";
export function Brand({ light = false }: { light?: boolean }) {
  const { data } = useStore();
  const { content } = useSiteContent();
  const logo = content.items.find((i) => i.kind === "logo");
  return (
    <Link
      to="/"
      className={`brand ${light ? "brand-light" : ""}`}
      aria-label={`${data.settings.name} — на главную`}
    >
      {imageSource(logo) ? (
        <ContentImage
          item={logo}
          className="brand-logo"
          alt={data.settings.name}
        />
      ) : (
        <span>{data.settings.name}</span>
      )}
      <small>{data.settings.tagline}</small>
    </Link>
  );
}
export function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight size={size} strokeWidth={1.5} />;
}
export function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const { data, error, saving } = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const active = document.activeElement as HTMLElement | null;
    element.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = old;
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">
            {data.settings.name.toLocaleUpperCase("ru-RU")} ·{" "}
            {data.settings.tagline.toLocaleUpperCase("ru-RU")}
          </span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X />
        </button>
      </div>
      {error && (
        <p className="form-error global-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={saving} style={{ display: "contents" }}>
        {children}
      </fieldset>
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">✳</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div className="toast" role="status">
      <Check size={19} />
      <span>{message}</span>
      <button onClick={onClose} aria-label="Закрыть сообщение">
        <X size={17} />
      </button>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Загружаем пространство AURA…
    </div>
  );
}
