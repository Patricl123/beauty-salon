import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  migrationFiles,
  TEST_ADMIN_ID,
  TEST_USER_ID,
} from "../../test-support/database";
import { initialServicesBlock, type SiteContent } from "./siteContent";

describe("Service content uses the existing trusted media references", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  async function call<T>(
    name: string,
    args: unknown[] = [],
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
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          args,
        )
      ).rows[0].result;
    });
  }
  const content = () => call<SiteContent>("get_site_content_admin");
  it("seeds current texts and all five fixed category references", async () => {
    const data = await content();
    expect(data.servicesBlock).toEqual(initialServicesBlock);
    expect(
      data.items
        .filter((i) => i.kind === "service_category")
        .map((i) => i.category),
    ).toEqual(["hair", "nails", "brows", "makeup", "care"]);
    expect(data.items.find((i) => i.id === "category:hair")).toMatchObject({
      legacySrc: "/images/hair.jpg",
      title: "Лёгкость в каждом движении",
    });
  });
  it("saves all category texts and block atomically, rejects stale or malformed changes", async () => {
    const before = await content();
    const items = before.items.map((i) =>
      i.kind === "service_category"
        ? {
            ...i,
            title: "Заголовок " + i.category,
            caption: "Подпись " + i.category,
            alt: "Фото " + i.category,
          }
        : i,
    );
    const block = {
      ...before.servicesBlock!,
      headingBefore: "Наши",
      headingEmphasis: "услуги",
      description: "Текст владельца",
    };
    const saved = await call<SiteContent>("save_site_content", [
      items,
      before.revision,
      block,
    ]);
    expect(saved.servicesBlock).toEqual(block);
    const pub = await call<SiteContent>("get_site_content", [], "anon", "");
    expect(pub.items.filter((i) => i.kind === "service_category")).toEqual(
      saved.items.filter((i) => i.kind === "service_category"),
    );
    await expect(
      call("save_site_content", [items, before.revision, block]),
    ).rejects.toThrow("CONTENT_CHANGED");
    await expect(
      call("save_site_content", [
        items,
        saved.revision,
        { ...block, description: "x".repeat(1001) },
      ]),
    ).rejects.toThrow("INVALID_CONTENT");
    await expect(
      call("save_site_content", [
        items.map((i) =>
          i.id === "category:hair"
            ? { ...i, assetId: crypto.randomUUID(), legacySrc: "" }
            : i,
        ),
        saved.revision,
        block,
      ]),
    ).rejects.toThrow("IMAGE_NOT_READY");
    expect(await content()).toEqual(saved);
  });
  it("category images are publicly readable and protected from GC, including empty categories and shared bindings", async () => {
    const asset = crypto.randomUUID();
    await db.query(
      "insert into private.site_media_assets(id,created_by,state,created_at) values($1,$2,'ready',now()-interval '2 days')",
      [asset, TEST_ADMIN_ID],
    );
    let data = await content();
    data = await call<SiteContent>("save_site_content", [
      data.items.map((i) =>
        i.kind === "service_category" || i.id === "hero"
          ? { ...i, assetId: asset, legacySrc: "" }
          : i,
      ),
      data.revision,
    ]);
    await db.exec("update public.services set active=false");
    expect(
      await call("media_asset_paths", [[asset], null], "service_role", ""),
    ).toEqual([{ id: asset, path: asset + ".webp" }]);
    expect(await call("media_gc_claim", [], "service_role", "")).toEqual([]);
    await call("media_gc_finish", [[asset]], "service_role", "");
    data = await call<SiteContent>("save_site_content", [
      data.items.map((i) =>
        i.id === "category:hair" ? { ...i, assetId: null } : i,
      ),
      data.revision,
    ]);
    expect(await call("media_gc_claim", [], "service_role", "")).toEqual([]);
    // An older client omitting the new rows cannot drop them or their text.
    const oldSave = await call<SiteContent>("save_site_content", [
      data.items.filter((i) => i.kind !== "service_category"),
      data.revision,
    ]);
    expect(oldSave.items.filter((i) => i.kind === "service_category")).toEqual(
      data.items.filter((i) => i.kind === "service_category"),
    );
    expect(oldSave.servicesBlock).toEqual(data.servicesBlock);
    data = await call<SiteContent>("save_site_content", [
      oldSave.items.map((i) => ({ ...i, assetId: null })),
      oldSave.revision,
    ]);
    expect(await call("media_gc_claim", [], "service_role", "")).toEqual([
      { id: asset, path: asset + ".webp" },
    ]);
    await call("media_gc_finish", [[asset]], "service_role", "");
    expect(
      (
        await db.query("select id from private.site_media_assets where id=$1", [
          asset,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("rejects anonymous, ordinary and inactive admins; invalid category IDs cannot be introduced", async () => {
    const data = await content();
    const args = [data.items, data.revision, data.servicesBlock];
    await expect(call("save_site_content", args, "anon", "")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      call("save_site_content", args, "authenticated", TEST_USER_ID),
    ).rejects.toThrow("ADMIN_REQUIRED");
    await db.query(
      "update private.admin_users set active=false where user_id=$1",
      [TEST_ADMIN_ID],
    );
    try {
      await expect(call("save_site_content", args)).rejects.toThrow(
        "ADMIN_REQUIRED",
      );
      await expect(
        call("media_begin_upload", [TEST_ADMIN_ID], "service_role", ""),
      ).rejects.toThrow("ADMIN_REQUIRED");
    } finally {
      await db.query(
        "update private.admin_users set active=true where user_id=$1",
        [TEST_ADMIN_ID],
      );
    }
    await expect(
      call("save_site_content", [
        data.items.map((i) =>
          i.id === "category:hair" ? { ...i, category: "custom" } : i,
        ),
        data.revision,
      ]),
    ).rejects.toThrow(/check constraint/i);
    expect(await content()).toEqual(data);
  });
});

it("010 preserves owner content when applied after 001–009", async () => {
  const db = await createTestDatabase({ legacy: true });
  try {
    for (const file of migrationFiles().filter(
      (f) => !f.name.startsWith("20261025") && !f.name.includes("0010_"),
    ))
      await db.exec(file.sql);
    await db.exec(
      "update private.site_images set caption='Подпись владельца',legacy_src='/images/owner.jpg' where id='hero'; update public.masters set specialty='маник' where id='aida'",
    );
    const old = (
      await db.query<{ result: SiteContent }>(
        "select private.site_content_json(true) result",
      )
    ).rows[0].result;
    await db.exec(migrationFiles().find((f) => f.name.includes("0010_"))!.sql);
    const current = (
      await db.query<{ result: SiteContent }>(
        "select private.site_content_json(true) result",
      )
    ).rows[0].result;
    for (const item of old.items)
      expect(current.items.find((i) => i.id === item.id)).toMatchObject(item);
    expect(
      (
        await db.query<{ specialty: string }>(
          "select specialty from public.masters where id='aida'",
        )
      ).rows[0].specialty,
    ).toBe("маник");
  } finally {
    await db.close();
  }
}, 60000);
