import type { Master, SalonSettings } from "../types";
import type { SiteImage } from "./siteContent";

export const isPublishedMaster = (master: Master) =>
  master.published === true && !master.archived;
export const isPublishedWork = (image: SiteImage) =>
  image.kind === "portfolio" && image.visible && !!image.assetId;

export function safeMapUrl(value: string | undefined, embed = false): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return "";
    const host = url.hostname;
    const path = url.pathname;
    const allowed = embed
      ? (["yandex.ru", "yandex.com"].includes(host) &&
          path.startsWith("/map-widget/v1/")) ||
        (host === "api-maps.yandex.ru" && path.startsWith("/frame/v1/")) ||
        (host === "www.google.com" && /^\/maps\/embed(?:\/|$)/.test(path))
      : (["yandex.ru", "yandex.com"].includes(host) &&
          path.startsWith("/maps/")) ||
        [
          "2gis.kg",
          "2gis.ru",
          "go.2gis.com",
          "maps.google.com",
          "maps.app.goo.gl",
        ].includes(host) ||
        (host === "www.google.com" && path.startsWith("/maps/"));
    return allowed ? url.href : "";
  } catch {
    return "";
  }
}
export function locationLinks(settings: SalonSettings) {
  const search = `https://yandex.ru/maps/?text=${encodeURIComponent(settings.address)}`;
  const map = safeMapUrl(settings.mapUrl);
  const confirmed = !!settings.mapConfirmed && !!map;
  return {
    confirmed,
    route: confirmed ? map : search,
    embed: confirmed ? safeMapUrl(settings.mapEmbedUrl, true) : "",
  };
}
