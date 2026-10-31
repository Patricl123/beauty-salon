import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
} from "@imagemagick/magick-wasm";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  migrationFiles,
  TEST_ADMIN_ID,
  TEST_USER_ID,
} from "../../test-support/database";
import {
  configureImageLimits,
  inspectImage,
  MAX_SOURCE_BYTES,
  processImage,
} from "../../supabase/functions/site-media/image";
import {
  createMediaHandler,
  type AssetPath,
  type MediaDependencies,
} from "../../supabase/functions/site-media/handler";
import type { SiteContent } from "./siteContent";
import type { AppData } from "../types";

let db: PGlite;
let png: Uint8Array;
const files = new Map<string, Uint8Array>();
async function call<T>(
  name: string,
  values: unknown[] = [],
  role = "authenticated",
  user = TEST_ADMIN_ID,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    return (
      await tx.query<{ result: T }>(
        `select public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
        values,
      )
    ).rows[0].result;
  });
}
const args: Record<string, string[]> = {
  media_begin_upload: ["p_actor"],
  media_finish_upload: ["p_actor", "p_id", "p_width", "p_height", "p_bytes"],
  media_asset_paths: ["p_ids", "p_actor"],
  media_gc_claim: [],
  media_gc_finish: ["p_ids"],
};
function dependencies(
  overrides: Partial<MediaDependencies> = {},
): MediaDependencies {
  return {
    origins: ["https://salon.example"],
    authenticate: async (token) =>
      token === "admin"
        ? TEST_ADMIN_ID
        : token === "viewer"
          ? TEST_USER_ID
          : null,
    isAdmin: async (token) =>
      call<boolean>(
        "is_admin",
        [],
        "authenticated",
        token === "admin" ? TEST_ADMIN_ID : TEST_USER_ID,
      ),
    isMaintenance: (token) => token === "maintenance-test",
    rpc: <T>(name: string, values: Record<string, unknown>) =>
      call<T>(
        name,
        args[name].map((k) => values[k]),
        "service_role",
        "",
      ),
    process: processImage,
    upload: async (path, bytes) => {
      files.set(path, bytes);
      await db.query(
        "insert into storage.objects(bucket_id,name) values('site-media',$1)",
        [path],
      );
    },
    sign: async (path) => "https://storage.example/signed/" + path,
    download: async (path) =>
      files.has(path)
        ? new Response(files.get(path)!)
        : new Response(null, { status: 404 }),
    remove: async (paths) => {
      for (const path of paths) files.delete(path);
      await db.query(
        "delete from storage.objects where bucket_id='site-media' and name=any($1)",
        [paths],
      );
    },
    ...overrides,
  };
}
const request = (
  action: string,
  token = "admin",
  body: BodyInit = png,
  mime = "image/png",
  extra: Record<string, string> = {},
) =>
  new Request(`https://edge.example/site-media?action=${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://salon.example",
      "Content-Type": mime,
      ...extra,
    },
    body,
  });
async function upload() {
  const response = await createMediaHandler(dependencies())(request("upload"));
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
}
const content = () => call<SiteContent>("get_site_content_admin");
async function publish(id: string, kind = "hero") {
  const current = await content();
  const items = current.items.map((i) =>
    i.kind === kind ? { ...i, assetId: id, legacySrc: "" } : i,
  );
  return call<SiteContent>("save_site_content", [items, current.revision]);
}
beforeAll(async () => {
  await initializeImageMagick(
    readFileSync(
      createRequire(import.meta.url).resolve(
        "@imagemagick/magick-wasm/magick.wasm",
      ),
    ),
  );
  configureImageLimits();
  png = ImageMagick.read(MagickColors.Transparent, 80, 60, (img) =>
    img.write(MagickFormat.Png, (data) => new Uint8Array(data)),
  );
  db = await createTestDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("Trusted image processing", () => {
  it("applies an actual JPEG EXIF orientation and removes its private profile", () => {
    const jpeg = ImageMagick.read(png, (img) =>
      img.write(MagickFormat.Jpeg, (data) => new Uint8Array(data)),
    );
    const description = new TextEncoder().encode("PRIVATE_EXIF_DESCRIPTION\0");
    const exif = new Uint8Array(44 + description.length),
      view = new DataView(exif.buffer);
    exif.set(new TextEncoder().encode("Exif\0\0II"));
    view.setUint16(8, 42, true);
    view.setUint32(10, 8, true);
    view.setUint16(14, 2, true);
    view.setUint16(16, 0x010e, true);
    view.setUint16(18, 2, true);
    view.setUint32(20, description.length, true);
    view.setUint32(24, 38, true);
    view.setUint16(28, 0x0112, true);
    view.setUint16(30, 3, true);
    view.setUint32(32, 1, true);
    view.setUint16(36, 6, true);
    exif.set(description, 44);
    const segment = new Uint8Array(4 + exif.length);
    segment.set([255, 225]);
    new DataView(segment.buffer).setUint16(2, exif.length + 2);
    segment.set(exif, 4);
    const source = new Uint8Array(jpeg.length + segment.length);
    source.set(jpeg.subarray(0, 2));
    source.set(segment, 2);
    source.set(jpeg.subarray(2), 2 + segment.length);
    ImageMagick.read(source, (img) =>
      expect(img.profileNames).toContain("exif"),
    );
    const output = processImage(source, "image/jpeg");
    expect([output.width, output.height]).toEqual([60, 80]);
    ImageMagick.read(output.bytes, (img) =>
      expect(img.profileNames).toHaveLength(0),
    );
    expect(new TextDecoder().decode(output.bytes)).not.toContain(
      "PRIVATE_EXIF_DESCRIPTION",
    );
  });
  it("decodes JPEG/PNG/WebP, strips metadata, crops and preserves logo transparency", () => {
    for (const [format, mime] of [
      [MagickFormat.Jpeg, "image/jpeg"],
      [MagickFormat.Png, "image/png"],
      [MagickFormat.WebP, "image/webp"],
    ] as const) {
      const source = ImageMagick.read(png, (img) => {
        img.comment = "PRIVATE_CAMERA_COMMENT";
        return img.write(format, (data) => new Uint8Array(data));
      });
      const output = processImage(source, mime, {
        x: 0.25,
        y: 0,
        width: 0.5,
        height: 1,
      });
      expect(output.width).toBe(40);
      expect(output.height).toBe(60);
      ImageMagick.read(output.bytes, (img) => {
        expect(img.format).toBe(MagickFormat.WebP);
        expect(img.profileNames).toHaveLength(0);
        expect(img.comment || "").toBe("");
        if (format !== MagickFormat.Jpeg) expect(img.hasAlpha).toBe(true);
      });
      expect(new TextDecoder().decode(output.bytes)).not.toContain(
        "PRIVATE_CAMERA_COMMENT",
      );
    }
  });
  it("optimizes real existing salon JPEG without changing the source", () => {
    const source = readFileSync("public/images/salon.jpg"),
      copy = Buffer.from(source);
    const output = processImage(source, "image/jpeg");
    expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(2048);
    expect(output.bytes.length).toBeLessThan(source.length);
    expect(source.equals(copy)).toBe(true);
  });
  it("rejects MIME forgery, SVG/executable content, corruption, oversized source and dimensions", () => {
    expect(() => processImage(png, "image/jpeg")).toThrow("INVALID_IMAGE");
    expect(() =>
      processImage(
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        "image/png",
      ),
    ).toThrow("UNSUPPORTED_IMAGE");
    expect(() =>
      processImage(new Uint8Array([77, 90, 0, 0]), "image/png"),
    ).toThrow("UNSUPPORTED_IMAGE");
    expect(() => processImage(png.slice(0, 35), "image/png")).toThrow(
      "INVALID_IMAGE",
    );
    expect(() =>
      inspectImage(new Uint8Array(MAX_SOURCE_BYTES + 1), "image/png"),
    ).toThrow("FILE_TOO_LARGE");
    const bomb = new Uint8Array(png);
    new DataView(bomb.buffer).setUint32(16, 50000);
    expect(() => inspectImage(bomb, "image/png")).toThrow("IMAGE_DIMENSIONS");
    expect(() =>
      processImage(png, "image/png", { x: -1, y: 0, width: 1, height: 1 }),
    ).toThrow("INVALID_CROP");
  });
});
describe("Media API, actual PostgreSQL grants and publication transactions", () => {
  it("only assigned admins can upload, preview and trigger cleanup", async () => {
    for (const token of ["", "forged", "viewer"]) {
      const process = vi.fn(processImage),
        remove = vi.fn();
      const handler = createMediaHandler(dependencies({ process, remove }));
      for (const action of ["upload", "preview", "cleanup"]) {
        const response = await handler(request(action, token));
        expect(response.status).toBe(token === "viewer" ? 403 : 401);
      }
      expect(process).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    }
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [
      { role: "admin", is_admin: true },
      TEST_USER_ID,
    ]);
    expect(await call("is_admin", [], "authenticated", TEST_USER_ID)).toBe(
      false,
    );
    await expect(
      call(
        "media_begin_upload",
        [TEST_ADMIN_ID],
        "authenticated",
        TEST_ADMIN_ID,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(call("media_gc_claim", [], "anon", "")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      call("media_begin_upload", [TEST_USER_ID], "service_role", ""),
    ).rejects.toThrow("ADMIN_REQUIRED");
    await expect(
      call("get_site_content_admin", [], "authenticated", TEST_USER_ID),
    ).rejects.toThrow("ADMIN_REQUIRED");
  });
  it("restrictive Storage policies defeat broad existing authenticated write policies", async () => {
    await db.exec(
      "insert into storage.objects(bucket_id,name) values('site-media','protected.webp')",
    );
    await db.exec(
      "create policy test_broad_objects on storage.objects for all to authenticated using(true) with check(true); create policy test_broad_buckets on storage.buckets for all to authenticated using(true) with check(true)",
    );
    for (const user of [TEST_ADMIN_ID, TEST_USER_ID]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
            user,
          ]);
          await tx.exec(
            "insert into storage.objects(bucket_id,name) values('site-media','arbitrary.webp')",
          );
        }),
      ).rejects.toThrow(/row-level security/i);
      const result = await db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        return tx.query(
          "update storage.buckets set public=true where id='site-media' returning id",
        );
      });
      expect(result.rows).toHaveLength(0);
      const deletion = await db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        return tx.query(
          "delete from storage.objects where bucket_id='site-media' returning name",
        );
      });
      expect(deletion.rows).toHaveLength(0);
    }
  });
  it("stages privately, publishes atomically and retains old image on validation/network failure", async () => {
    const staged = await upload();
    const handler = createMediaHandler(dependencies());
    expect(
      (
        await handler(
          new Request(`https://edge.example/site-media?id=${staged.id}`),
        )
      ).status,
    ).toBe(404);
    const published = await publish(staged.id);
    expect(
      (
        await handler(
          new Request(`https://edge.example/site-media?id=${staged.id}`),
        )
      ).headers.get("content-type"),
    ).toBe("image/webp");
    const broken = published.items.map((i) =>
      i.id === "hero" ? { ...i, assetId: crypto.randomUUID() } : i,
    );
    await expect(
      call("save_site_content", [broken, published.revision]),
    ).rejects.toThrow("IMAGE_NOT_READY");
    const failed = await createMediaHandler(
      dependencies({
        upload: async () => {
          throw Error("storage offline");
        },
      }),
    )(request("upload"));
    expect(failed.status).toBe(503);
    expect((await content()).items.find((i) => i.id === "hero")?.assetId).toBe(
      staged.id,
    );
    const bad = await handler(
      request("upload", "admin", new TextEncoder().encode("not a photo")),
    );
    expect(bad.status).toBe(400);
    const rejected = await handler(
      request("upload", "admin", png, "image/png", {
        "content-length": String(MAX_SOURCE_BYTES + 1),
      }),
    );
    expect(rejected.status).toBe(413);
    expect((await content()).revision).toBe(published.revision);
  });
  it("persists ordering/hiding, rejects stale editors and arbitrary image paths", async () => {
    const work = await upload();
    const current = await content();
    const items = current.items.map(i => i.kind === "portfolio" ? { ...i, assetId: work.id, legacySrc: "" } : i).map((i) =>
      i.id === "portfolio:hair"
        ? { ...i, position: 8, visible: false }
        : i.id === "portfolio:makeup"
          ? { ...i, position: 0, caption: "Новая подпись" }
          : i,
    );
    const saved = await call<SiteContent>("save_site_content", [
      items,
      current.revision,
    ]);
    await expect(
      call("save_site_content", [current.items, current.revision]),
    ).rejects.toThrow("CONTENT_CHANGED");
    await expect(
      call("save_site_content", [items, saved.revision], "anon", ""),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      call(
        "save_site_content",
        [items, saved.revision],
        "authenticated",
        TEST_USER_ID,
      ),
    ).rejects.toThrow("ADMIN_REQUIRED");
    const visitor = await call<SiteContent>("get_site_content", [], "anon", "");
    const portfolio = visitor.items.filter((i) => i.kind === "portfolio");
    expect(portfolio.map((i) => i.id)).toEqual([
      "portfolio:makeup",
      "portfolio:nails",
    ]);
    expect(portfolio[0].caption).toBe("Новая подпись");
    await expect(
      call("save_site_content", [
        items.map((i) =>
          i.id === "logo"
            ? { ...i, legacySrc: "https://evil.example/payload.svg" }
            : i,
        ),
        saved.revision,
      ]),
    ).rejects.toThrow("INVALID_IMAGE_REFERENCE");
  });
  it("saves master photo with the existing profile transaction and rejects a stale photo version", async () => {
    const staged = await upload();
    const before = await call<AppData>("get_admin_snapshot");
    const master = {
      ...before.masters[0],
      photo: "",
      photoAssetId: staged.id,
      photoAlt: "Портрет мастера",
    };
    const after = await call<AppData>("admin_apply_changes", [
      { masters: [master] },
      before.revision,
      false,
    ]);
    expect(after.masters.find((m) => m.id === master.id)?.photoAssetId).toBe(
      staged.id,
    );
    expect(after.appointments).toEqual(before.appointments);
    await expect(
      call("admin_apply_changes", [
        { masters: [{ ...master, name: "Stale editor" }] },
        after.revision,
        false,
      ]),
    ).rejects.toThrow("IMAGE_CHANGED");
    const fresh = await call<AppData>("get_admin_snapshot");
    expect(fresh.masters.find((m) => m.id === master.id)?.name).toBe(
      master.name,
    );
  });
  it("GC retains every reference (including hidden/shared), claims orphans and blocks resurrection", async () => {
    const orphan = await upload(),
      shared = await upload();
    const state = await content();
    const items = state.items.map((i) =>
      i.kind === "hero" || i.kind === "salon"
        ? {
            ...i,
            assetId: shared.id,
            legacySrc: "",
            visible: i.kind !== "salon",
          }
        : i,
    );
    const saved = await call<SiteContent>("save_site_content", [
      items,
      state.revision,
    ]);
    await db.exec(
      "update private.site_media_assets set created_at=now()-interval '2 days'",
    );
    const claimed = await call<AssetPath[]>(
      "media_gc_claim",
      [],
      "service_role",
      "",
    );
    expect(claimed.some((a) => a.id === orphan.id)).toBe(true);
    expect(claimed.some((a) => a.id === shared.id)).toBe(false);
    const masters = await call<AppData>("get_admin_snapshot");
    expect(claimed.some((a) => a.id === masters.masters[0].photoAssetId)).toBe(
      false,
    );
    await expect(
      call("save_site_content", [
        items.map((i) => (i.id === "hero" ? { ...i, assetId: orphan.id } : i)),
        saved.revision,
      ]),
    ).rejects.toThrow("IMAGE_NOT_READY");
    const failed = await createMediaHandler(
      dependencies({
        remove: async () => {
          throw Error("offline");
        },
      }),
    )(request("cleanup", "admin", "{}", "application/json"));
    expect(failed.status).toBe(503);
    const retried = await createMediaHandler(dependencies())(
      request(
        "cleanup",
        "admin",
        JSON.stringify({ path: shared.id + ".webp" }),
        "application/json",
      ),
    );
    expect(retried.status).toBe(200);
    expect(files.has(shared.id + ".webp")).toBe(true);
    expect(files.has(orphan.id + ".webp")).toBe(false);
    expect(
      (await call<AssetPath[]>("media_gc_claim", [], "service_role", ""))
        .length,
    ).toBe(0);
  });
});

describe("Additive media migration on an existing salon", () => {
  it("preserves bookings, management codes, configured photos and admin membership", async () => {
    const previous = await createTestDatabase({ legacy: true });
    try {
      const managementCode = "d".repeat(64);
      const { addDays, today } = await import("./schedule");
      const created = await previous.query<{ booking: { id: string } }>(
        "select public.create_appointment($1,$2,$3) booking",
        [
          crypto.randomUUID(),
          managementCode,
          {
            serviceId: "haircut",
            masterId: "aida",
            date: addDays(today(), 2),
            time: "10:00",
            clientName: "Проверка миграции",
            phone: "+996000000081",
            comment: "",
            expectedPrice: 2200,
            expectedDuration: 60,
            consent: true,
            owner: "visitor",
          },
        ],
      );
      await previous.exec(
        migrationFiles().find(
          (f) => f.name === "202610270005_booking_protection.sql",
        )!.sql,
      );
      await previous.exec(
        "update public.masters set photo='https://example.test/existing.jpg' where id='aida'",
      );
      const bookings = (
        await previous.query("select * from public.appointments order by id")
      ).rows;
      const photos = (
        await previous.query("select id,photo from public.masters order by id")
      ).rows;
      const admins = (
        await previous.query(
          "select * from private.admin_users order by user_id",
        )
      ).rows;
      await previous.exec(
        migrationFiles().find((f) => f.name === "202610280006_site_media.sql")!
          .sql,
      );
      expect(
        (await previous.query("select * from public.appointments order by id"))
          .rows,
      ).toEqual(bookings);
      expect(
        (
          await previous.query(
            "select id,photo from public.masters order by id",
          )
        ).rows,
      ).toEqual(photos);
      expect(
        (
          await previous.query(
            "select * from private.admin_users order by user_id",
          )
        ).rows,
      ).toEqual(admins);
      const read = await previous.query<{ booking: { id: string } }>(
        "select public.booking_gateway_execute('read',$1) booking",
        [{ p_id: created.rows[0].booking.id, p_manage_token: managementCode }],
      );
      expect(read.rows[0].booking.id).toBe(created.rows[0].booking.id);
    } finally {
      await previous.close();
    }
  }, 60000);
});
