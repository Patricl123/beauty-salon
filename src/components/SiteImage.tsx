import { useState, type ImgHTMLAttributes } from "react";
import type { Master } from "../types";
import { imageSource, type SiteImage as ImageData } from "../lib/siteContent";

// Keep an img element so existing layout/object-fit rules remain intact.
const placeholder =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#e9e3d9"/><path d="M320 440l65-80 45 48 35-38 65 90H270" fill="none" stroke="#9a958a" stroke-width="5"/><circle cx="460" cy="300" r="22" fill="none" stroke="#9a958a" stroke-width="5"/></svg>',
  );
export function SafeImage({
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState("");
  return (
    <img
      {...props}
      src={!src || failed === src ? placeholder : src}
      alt={alt || ""}
      onError={() => setFailed(src || "")}
    />
  );
}
export function ContentImage({
  item,
  ...props
}: { item?: ImageData } & ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <SafeImage
      {...props}
      src={imageSource(item)}
      alt={item?.alt || props.alt || ""}
    />
  );
}
export function MasterImage({
  master,
  ...props
}: { master: Master } & ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <SafeImage
      {...props}
      src={imageSource({
        assetId: master.photoAssetId || null,
        legacySrc: master.photo,
      })}
      alt={master.photoAlt || props.alt || master.name}
    />
  );
}
