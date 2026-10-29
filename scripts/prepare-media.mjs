import { copyFileSync, mkdirSync } from "node:fs";
const directory = new URL(
  "../supabase/functions/site-media/vendor/",
  import.meta.url,
);
mkdirSync(directory, { recursive: true });
copyFileSync(
  new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
  new URL("magick.wasm", directory),
);
console.log("ImageMagick WASM prepared for the site-media Edge Function.");
