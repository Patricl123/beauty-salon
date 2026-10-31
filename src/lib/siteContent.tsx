import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isSupabase, requireSupabase } from "./supabase";

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageDraft {
  assetId: string | null;
  legacySrc: string;
  alt: string;
  file?: File;
  crop?: Crop;
  previewUrl?: string;
}
export interface SiteImage extends ImageDraft {
  id: string;
  kind: "hero" | "salon" | "logo" | "portfolio" | "service_category";
  title?: string;
  caption: string;
  category: string;
  position: number;
  visible: boolean;
}
export interface SiteContent {
  revision: number;
  items: SiteImage[];
  servicesBlock?: ServicesBlock;
}
export interface ServicesBlock {
  eyebrow: string;
  headingBefore: string;
  headingEmphasis: string;
  headingAfter: string;
  description: string;
  footnote: string;
}
export const initialServicesBlock: ServicesBlock = {
  eyebrow: 'МАЛЕНЬКИЕ РИТУАЛЫ КРАСОТЫ',
  headingBefore: 'То, что вам', headingEmphasis: 'нужно', headingAfter: '',
  description: 'От любимой стрижки до часа тишины.\nВыбирайте заботу по настроению.',
  footnote: 'Стоимость фиксируется при записи. Без онлайн-оплаты.',
};
const item = (
  id: string,
  kind: SiteImage["kind"],
  legacySrc: string,
  alt: string,
  position = 0,
  caption = "",
  category = "",
): SiteImage => ({
  id,
  kind,
  legacySrc,
  alt,
  position,
  caption,
  category,
  visible: true,
  assetId: null,
});
export const initialContent: SiteContent = {
  revision: 0,
  servicesBlock: initialServicesBlock,
  items: [
    ...([
      ['hair', 'Волосы', '/images/hair.jpg', 'Лёгкость в каждом движении'],
      ['nails', 'Ногти', '/images/nails.jpg', 'Красота в деталях'],
      ['brows', 'Брови и ресницы', '/images/master-diana.jpg', 'Позвольте себе сиять'],
      ['makeup', 'Макияж', '/images/master-elina.jpg', 'Позвольте себе сиять'],
      ['care', 'Уход', '/images/care.jpg', 'Позвольте себе сиять'],
    ] as const).map(([category, label, src, title], index) => ({
      ...item(`category:${category}`, 'service_category', src, `Вдохновение для категории «${label}»`, index, '01 — ВАША НОВАЯ ИСТОРИЯ', category), title,
    })),
    item(
      "hero",
      "hero",
      "/images/salon.jpg",
      "Интерьер салона с креслами и круглыми зеркалами",
    ),
    item("logo", "logo", "", ""),
    item("salon:initial", "salon", "/images/salon.jpg", "Интерьер салона"),
    item(
      "portfolio:hair",
      "portfolio",
      "/images/hair.jpg",
      "Мягкая текстура",
      0,
      "Мягкая текстура",
      "Укладка и локоны",
    ),
    item(
      "portfolio:nails",
      "portfolio",
      "/images/nails.jpg",
      "Графичные акценты",
      1,
      "Графичные акценты",
      "Маникюр с покрытием",
    ),
    item(
      "portfolio:makeup",
      "portfolio",
      "/images/master-elina.jpg",
      "Естественное сияние",
      2,
      "Естественное сияние",
      "Лёгкий дневной макияж",
    ),
  ],
};
const endpoint = () =>
  `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/site-media`;
export function imageSource(value?: Pick<ImageDraft, "assetId" | "legacySrc">) {
  return value?.assetId && isSupabase
    ? `${endpoint()}?id=${encodeURIComponent(value.assetId)}`
    : value?.legacySrc || "";
}
const messages: Record<string, string> = {
  INVALID_CONTENT: 'Проверьте длину текстов и заполнение блока услуг. Изменения не сохранены.',
  LOGIN_REQUIRED: "Сеанс истёк. Войдите снова.",
  ADMIN_REQUIRED: "Загрузка доступна только назначенным администраторам.",
  UNSUPPORTED_IMAGE:
    "Выберите JPEG, PNG или WebP. SVG и другие форматы не поддерживаются.",
  INVALID_IMAGE:
    "Не удалось прочитать изображение. Файл повреждён или его содержимое не соответствует формату.",
  FILE_TOO_LARGE:
    "Файл слишком большой. Максимальный размер исходного изображения — 10 МБ.",
  IMAGE_DIMENSIONS:
    "Изображение слишком большое: максимум 6000 пикселей по стороне и 12,5 мегапикселя.",
  INVALID_CROP: "Не удалось применить обрезку. Выберите область заново.",
  ANIMATION_NOT_ALLOWED:
    "Анимированные изображения не поддерживаются. Выберите обычную фотографию.",
  CONTENT_CHANGED:
    "Другой администратор уже изменил контент. Ваш черновик сохранён на экране. Загрузите актуальную версию и повторите изменения.",
  IMAGE_NOT_READY:
    "Изображение больше не доступно для сохранения. Выберите файл снова.",
  MEDIA_RATE_LIMIT:
    "Слишком много загрузок. Повторите позже (до 60 попыток в час).",
  UPLOAD_FAILED:
    "Не удалось загрузить файл. Старое изображение сохранено. Повторите попытку.",
  ORIGIN_DENIED:
    "Адрес сайта не разрешён в настройках загрузки. Проверьте SITE_MEDIA_ALLOWED_ORIGINS.",
};
export function mediaError(error: unknown) {
  const code =
    error instanceof Error
      ? error.message
      : String((error as { message?: string })?.message || "");
  return (
    Object.entries(messages).find(([key]) => code.includes(key))?.[1] ||
    "Не удалось подтвердить сохранение. Проверьте соединение и загрузите актуальную версию перед повтором."
  );
}
export async function mediaRequest<T>(
  action: string,
  body?: BodyInit,
  crop?: Crop,
): Promise<T> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error || !data.session) throw new Error("LOGIN_REQUIRED");
  const response = await fetch(`${endpoint()}?action=${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": body instanceof File ? body.type : "application/json",
      ...(crop ? { "X-Image-Crop": JSON.stringify(crop) } : {}),
    },
    body: body || "{}",
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error)
    throw new Error(result?.error || "MEDIA_UNAVAILABLE");
  return result as T;
}
export async function stageImage(value: ImageDraft): Promise<ImageDraft> {
  if (!value.file) return value;
  const uploaded = await mediaRequest<{ id: string; previewUrl: string }>(
    "upload",
    value.file,
    value.crop,
  );
  return {
    assetId: uploaded.id,
    legacySrc: "",
    alt: value.alt,
    previewUrl: uploaded.previewUrl,
  };
}
export async function previewImages(
  ids: string[],
): Promise<Record<string, string>> {
  return ids.length
    ? mediaRequest<Record<string, string>>(
        "preview",
        JSON.stringify({ ids: [...new Set(ids)] }),
      )
    : {};
}
export const cleanImage = ({
  id,
  kind,
  assetId,
  legacySrc,
  alt,
  caption,
  category,
  position,
  visible,
  title,
}: SiteImage): SiteImage => ({
  id,
  kind,
  assetId,
  legacySrc,
  alt,
  caption,
  category,
  position,
  visible,
  title,
});
const Context = createContext({
  content: initialContent,
  refresh: async () => {},
});
export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState(initialContent);
  const refresh = useCallback(async () => {
    if (!isSupabase) return;
    const { data, error } = await requireSupabase().rpc("get_site_content");
    // A missing media migration or media outage must never block booking/catalog.
    if (!error && data?.items)
      setContent((previous) =>
        data.revision >= previous.revision ? data : previous,
      );
  }, []);
  useEffect(() => {
    void refresh();
    const sync = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = setInterval(sync, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);
  return (
    <Context.Provider value={{ content, refresh }}>{children}</Context.Provider>
  );
}
export const useSiteContent = () => useContext(Context);
