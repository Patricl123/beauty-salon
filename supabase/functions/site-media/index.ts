import { initializeImageMagick } from "@imagemagick/magick-wasm";
import { createClient } from "@supabase/supabase-js";
import { createMediaHandler } from "./handler.ts";
import { configureImageLimits, MediaError, processImage } from "./image.ts";

await initializeImageMagick(
  await Deno.readFile(new URL("./vendor/magick.wasm", import.meta.url)),
);
configureImageLimits();
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = client.storage.from("site-media");
Deno.serve(
  createMediaHandler({
    origins: (Deno.env.get("SITE_MEDIA_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    authenticate: async (token) => {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : data.user?.id || null;
    },
    isAdmin: async (token) => {
      const response = await fetch(url + "/rest/v1/rpc/is_admin", {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });
      return response.ok && (await response.json()) === true;
    },
    isMaintenance: (token) => token === key,
    rpc: async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await client.rpc(name, args);
      if (error) {
        if (error.message.includes("ADMIN_REQUIRED"))
          throw new MediaError("ADMIN_REQUIRED", 403);
        if (error.message.includes("MEDIA_RATE_LIMIT"))
          throw new MediaError("MEDIA_RATE_LIMIT", 429);
        throw new MediaError("MEDIA_UNAVAILABLE", 503);
      }
      return data as T;
    },
    process: processImage,
    upload: async (path, bytes) => {
      const { error } = await bucket.upload(path, bytes, {
        contentType: "image/webp",
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new MediaError("UPLOAD_FAILED", 503);
    },
    sign: async (path) => {
      const { data, error } = await bucket.createSignedUrl(path, 3600);
      if (error) throw new MediaError("MEDIA_UNAVAILABLE", 503);
      return data.signedUrl;
    },
    download: (path) =>
      fetch(
        url +
          "/storage/v1/object/authenticated/site-media/" +
          encodeURIComponent(path),
        {
          headers: { apikey: key, Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(15000),
        },
      ),
    remove: async (paths) => {
      const { error } = await bucket.remove(paths);
      if (error) throw new MediaError("CLEANUP_FAILED", 503);
    },
  }),
);
