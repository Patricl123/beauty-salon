import {
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  ResourceLimits,
} from "@imagemagick/magick-wasm";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 12_500_000;
export const MAX_SIDE = 6000;
export function configureImageLimits() {
  ResourceLimits.memory = 128n * 1024n * 1024n;
  ResourceLimits.disk = 0n;
  ResourceLimits.width = BigInt(MAX_SIDE);
  ResourceLimits.height = BigInt(MAX_SIDE);
  // ImageMagick needs temporary images even for a single-frame decode/resize.
  // Animated source formats are rejected by inspectImage before decoding.
  ResourceLimits.listLength = 16n;
  ResourceLimits.maxProfileSize = 1024n * 1024n;
}
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export class MediaError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const invalid = () => {
  throw new MediaError("INVALID_IMAGE");
};

// Inspect dimensions BEFORE allocating a decoded pixel buffer. Never sniff SVG or
// pass arbitrary formats to ImageMagick; decoding is explicitly forced below.
export function inspectImage(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES)
    throw new MediaError("FILE_TOO_LARGE", 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (a: number, n: number) =>
    String.fromCharCode(...bytes.subarray(a, a + n));
  const le24 = (p: number) =>
    bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
  let width = 0,
    height = 0,
    format: MagickFormat;
  if (
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    str(1, 3) === "PNG" &&
    str(12, 4) === "IHDR"
  ) {
    if (
      mime !== "image/png" ||
      view.getUint32(8) !== 13 ||
      str(4, 4) !== "\r\n\x1a\n"
    )
      invalid();
    format = MagickFormat.Png;
    width = view.getUint32(16);
    height = view.getUint32(20);
    let ended = false;
    for (let p = 8; p + 12 <= bytes.length;) {
      const size = view.getUint32(p),
        type = str(p + 4, 4);
      if (p + size + 12 > bytes.length) invalid();
      if (type === "acTL") throw new MediaError("ANIMATION_NOT_ALLOWED");
      p += size + 12;
      if (type === "IEND") {
        ended = true;
        break;
      }
    }
    if (!ended) invalid();
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) {
    if (mime !== "image/jpeg") invalid();
    format = MagickFormat.Jpeg;
    for (let p = 2; p + 4 <= bytes.length;) {
      if (bytes[p++] !== 255) invalid();
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > bytes.length) invalid();
      const size = view.getUint16(p);
      if (size < 2 || p + size > bytes.length) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (size < 8) invalid();
        height = view.getUint16(p + 3);
        width = view.getUint16(p + 5);
        break;
      }
      p += size;
    }
  } else if (
    bytes.length >= 30 &&
    str(0, 4) === "RIFF" &&
    str(8, 4) === "WEBP"
  ) {
    if (mime !== "image/webp" || view.getUint32(4, true) + 8 !== bytes.length)
      invalid();
    format = MagickFormat.WebP;
    for (let p = 12; p + 8 <= bytes.length;) {
      const type = str(p, 4),
        size = view.getUint32(p + 4, true),
        d = p + 8;
      if (d + size > bytes.length) invalid();
      if (
        type === "ANIM" ||
        type === "ANMF" ||
        (type === "VP8X" && bytes[d] & 2)
      )
        throw new MediaError("ANIMATION_NOT_ALLOWED");
      if (type === "VP8X" && size >= 10) {
        width = le24(d + 4) + 1;
        height = le24(d + 7) + 1;
      } else if (
        !width &&
        type === "VP8 " &&
        size >= 10 &&
        str(d + 3, 3) === "\x9d\x01\x2a"
      ) {
        width = view.getUint16(d + 6, true) & 0x3fff;
        height = view.getUint16(d + 8, true) & 0x3fff;
      } else if (!width && type === "VP8L" && size >= 5 && bytes[d] === 47) {
        const bits = view.getUint32(d + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      p = d + size + (size % 2);
    }
  } else throw new MediaError("UNSUPPORTED_IMAGE");
  if (!width || !height) invalid();
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw new MediaError("IMAGE_DIMENSIONS", 413);
  return { width, height, format };
}

export function processImage(bytes: Uint8Array, mime: string, crop?: Crop) {
  const header = inspectImage(bytes, mime);
  if (
    crop &&
    (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.x + crop.width > 1.000001 ||
      crop.y + crop.height > 1.000001)
  )
    throw new MediaError("INVALID_CROP");
  try {
    return ImageMagick.read(bytes, header.format, (img) => {
      if (img.width !== header.width || img.height !== header.height) invalid();
      img.autoOrient();
      if (crop) {
        const x = Math.floor(img.width * crop.x),
          y = Math.floor(img.height * crop.y);
        img.crop(
          new MagickGeometry(
            x,
            y,
            Math.max(
              1,
              Math.min(img.width - x, Math.round(img.width * crop.width)),
            ),
            Math.max(
              1,
              Math.min(img.height - y, Math.round(img.height * crop.height)),
            ),
          ),
        );
        img.resetPage();
      }
      const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
      if (scale < 1)
        img.resize(
          Math.max(1, Math.round(img.width * scale)),
          Math.max(1, Math.round(img.height * scale)),
        );
      img.strip(); // EXIF, GPS, comments and profiles never enter the published file.
      img.quality = 82; // WebP retains alpha; never flatten logos onto a background.
      return img.write(MagickFormat.WebP, (result) => {
        if (result.length > 5 * 1024 * 1024)
          throw new MediaError("FILE_TOO_LARGE", 413);
        return {
          bytes: new Uint8Array(result),
          width: img.width,
          height: img.height,
        };
      });
    });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("INVALID_IMAGE");
  }
}
