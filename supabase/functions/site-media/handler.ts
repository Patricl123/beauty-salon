import { MAX_SOURCE_BYTES, MediaError, type Crop } from "./image.ts";

export interface AssetPath {
  id: string;
  path: string;
}
export interface MediaDependencies {
  origins: string[];
  authenticate: (token: string) => Promise<string | null>;
  isAdmin: (token: string) => Promise<boolean>;
  isMaintenance: (token: string) => boolean;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
  process: (
    bytes: Uint8Array,
    mime: string,
    crop?: Crop,
  ) => { bytes: Uint8Array; width: number; height: number };
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  sign: (path: string) => Promise<string>;
  download: (path: string) => Promise<Response>;
  remove: (paths: string[]) => Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function boundedBody(req: Request, limit: number) {
  if (Number(req.headers.get("content-length")) > limit)
    throw new MediaError("FILE_TOO_LARGE", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new MediaError("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new MediaError("FILE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function createMediaHandler(deps: MediaDependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin") || "";
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info,x-image-crop",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (deps.origins.includes(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    const json = (data: unknown, status = 200) =>
      Response.json(data, { status, headers });
    try {
      if (req.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      if (req.method === "GET") {
        const id = new URL(req.url).searchParams.get("id") || "";
        if (!uuid.test(id)) throw new MediaError("IMAGE_NOT_FOUND", 404);
        const rows = await deps.rpc<AssetPath[]>("media_asset_paths", {
          p_ids: [id],
          p_actor: null,
        });
        if (!rows.length) throw new MediaError("IMAGE_NOT_FOUND", 404);
        const file = await deps.download(rows[0].path);
        if (!file.ok || !file.body)
          throw new MediaError("IMAGE_NOT_FOUND", 404);
        return new Response(file.body, {
          headers: {
            ...headers,
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=3600, immutable",
          },
        });
      }
      if (req.method !== "POST")
        throw new MediaError("METHOD_NOT_ALLOWED", 405);
      if (origin && !deps.origins.includes(origin))
        throw new MediaError("ORIGIN_DENIED", 403);
      const token =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const action = new URL(req.url).searchParams.get("action");
      const maintenance =
        action === "cleanup" && !!token && deps.isMaintenance(token);
      let actor: string | null = null;
      if (!maintenance) {
        actor = token ? await deps.authenticate(token) : null;
        if (!actor) throw new MediaError("LOGIN_REQUIRED", 401);
        if (!(await deps.isAdmin(token)))
          throw new MediaError("ADMIN_REQUIRED", 403);
      }
      if (action === "upload") {
        const mime = (req.headers.get("content-type") || "").split(";")[0];
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
          throw new MediaError("UNSUPPORTED_IMAGE");
        let crop: Crop | undefined;
        const cropHeader = req.headers.get("x-image-crop");
        if (cropHeader) {
          if (cropHeader.length > 300) throw new MediaError("INVALID_CROP");
          try {
            crop = JSON.parse(cropHeader);
          } catch {
            throw new MediaError("INVALID_CROP");
          }
          if (!crop || typeof crop !== "object")
            throw new MediaError("INVALID_CROP");
        }
        // Reserve first: crashes/failed uploads leave a known, collectable object path.
        const reserved = await deps.rpc<AssetPath>("media_begin_upload", {
          p_actor: actor,
        });
        const input = await boundedBody(req, MAX_SOURCE_BYTES);
        const output = deps.process(input, mime, crop);
        await deps.upload(reserved.path, output.bytes);
        await deps.rpc("media_finish_upload", {
          p_actor: actor,
          p_id: reserved.id,
          p_width: output.width,
          p_height: output.height,
          p_bytes: output.bytes.length,
        });
        return json({
          id: reserved.id,
          previewUrl: await deps.sign(reserved.path),
        });
      }
      if (action === "preview") {
        let body: { ids?: unknown };
        try {
          body = JSON.parse(
            new TextDecoder().decode(await boundedBody(req, 8192)),
          );
        } catch {
          throw new MediaError("INVALID_REQUEST");
        }
        if (
          !Array.isArray(body?.ids) ||
          body.ids.length > 100 ||
          body.ids.some((id) => typeof id !== "string" || !uuid.test(id))
        )
          throw new MediaError("INVALID_REQUEST");
        const rows = await deps.rpc<AssetPath[]>("media_asset_paths", {
          p_ids: body.ids,
          p_actor: actor,
        });
        const entries = await Promise.all(
          rows.map(async (a) => [a.id, await deps.sign(a.path)]),
        );
        return json(Object.fromEntries(entries));
      }
      if (action === "cleanup") {
        // No paths or IDs from request bodies are used for deletion.
        const rows = await deps.rpc<AssetPath[]>("media_gc_claim", {});
        if (rows.length) {
          await deps.remove(rows.map((a) => a.path));
          await deps.rpc("media_gc_finish", { p_ids: rows.map((a) => a.id) });
        }
        return json({ deleted: rows.length });
      }
      throw new MediaError("INVALID_REQUEST");
    } catch (error) {
      if (error instanceof MediaError)
        return json({ error: error.code }, error.status);
      // Never echo Storage, SQL, Auth or decoder internals (or tokens) to the browser.
      return json({ error: "MEDIA_UNAVAILABLE" }, 503);
    }
  };
}
