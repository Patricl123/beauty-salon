import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { AppData } from "../src/types";
import type { SiteContent } from "../src/lib/siteContent";
import { masterSpecialties } from "../src/lib/masterSpecialties";
import { categories } from "../src/i18n";

async function api(request: APIRequestContext) {
  const session = await (
    await request.post("http://127.0.0.1:15329/auth/v1/token", {
      data: { email: "admin@example.test", password: "TestingOnly123!" },
    })
  ).json();
  return async <T>(name: string, data = {}): Promise<T> => {
    const r = await request.post("http://127.0.0.1:15329/rest/v1/rpc/" + name, {
      headers: { Authorization: "Bearer " + session.access_token },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
}
async function login(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("TestingOnly123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Разделы админ-панели" }),
  ).toBeVisible();
}

test("specialties are fixed; only this master keeps its old value; publishing and services survive", async ({
  page,
  request,
}) => {
  const call = await api(request);
  const original = await call<AppData>("get_admin_snapshot");
  const save = (data: AppData) =>
    call<AppData>("admin_apply_changes", {
      p_changes: { masters: data.masters },
      p_expected_revision: data.revision,
    });
  try {
    await save({
      ...original,
      masters: original.masters.map((m) => ({
        ...m,
        specialty:
          m.id === "aida"
            ? "маник"
            : m.id === "aliya"
              ? "стрижка.ресницы"
              : m.specialty,
      })),
    });
    await login(page);
    await page.getByRole("button", { name: "Мастера", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить мастера", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const select = dialog.getByRole("combobox", {
      name: "Специализация",
      exact: true,
    });
    expect(await select.locator("option").allTextContents()).toEqual([
      "Выберите специализацию",
      ...masterSpecialties,
    ]);
    await expect(
      dialog.getByRole("checkbox", {
        name: "Показывать мастера на сайте и разрешить онлайн-запись",
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    const card = page.locator(".admin-master-card").filter({
      has: page.getByRole("heading", { name: "Аида", exact: true }),
    });
    await card.getByRole("button", { name: "Профиль и график" }).click();
    await expect(select).toHaveValue("маник");
    expect(await select.locator("option").allTextContents()).toEqual([
      "Выберите специализацию",
      "Текущее значение — выберите специализацию из списка: маник",
      ...masterSpecialties,
    ]);
    await dialog
      .getByRole("button", { name: "Сохранить мастера", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      (await call<AppData>("get_admin_snapshot")).masters.find(
        (m) => m.id === "aida",
      )?.specialty,
    ).toBe("маник");
    await card.getByRole("button", { name: "Профиль и график" }).click();
    await select.selectOption("Колорист");
    await dialog
      .getByRole("button", { name: "Сохранить мастера", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Мастера", exact: true }).click();
    await card.getByRole("button", { name: "Профиль и график" }).click();
    await expect(select).toHaveValue("Колорист");
    expect(await select.locator("option").allTextContents()).toEqual([
      "Выберите специализацию",
      ...masterSpecialties,
    ]);
    const saved = (await call<AppData>("get_admin_snapshot")).masters.find(
      (m) => m.id === "aida",
    )!;
    const before = original.masters.find((m) => m.id === "aida")!;
    expect(saved).toMatchObject({
      serviceIds: before.serviceIds,
      published: before.published,
      photo: before.photo,
      days: before.days,
    });
  } finally {
    const current = await call<AppData>("get_admin_snapshot");
    await save({
      ...current,
      masters: current.masters.map((m) => ({
        ...m,
        specialty: original.masters.find((o) => o.id === m.id)!.specialty,
      })),
    });
  }
});

test("all category photos and service texts publish together, survive reload, and failed upload leaves old content", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  const call = await api(request);
  const original = await call<SiteContent>("get_site_content_admin");
  page.on("dialog", (d) => d.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  const visitor = await browser.newContext({
    baseURL: "http://127.0.0.1:5175",
    viewport: { width: 390, height: 844 },
  });
  try {
    await login(page);
    await page
      .getByRole("button", { name: "Контент сайта", exact: true })
      .click();
    const editor = page.locator(".services-block-editor");
    await editor
      .getByLabel("Надзаголовок", { exact: true })
      .fill("Ритуалы владельца");
    await editor
      .getByLabel("Заголовок — до курсива", { exact: true })
      .fill("Забота");
    await editor
      .getByLabel("Заголовок — курсив", { exact: true })
      .fill("для вас");
    await editor
      .getByLabel("Заголовок — после курсива", { exact: true })
      .fill("каждый день");
    await editor
      .getByLabel("Описание блока", { exact: true })
      .fill("Описание без <b>HTML</b>");
    await editor
      .getByLabel("Примечание под услугами", { exact: true })
      .fill("Примечание владельца");
    for (const [id] of Object.entries(categories)) {
      const row = editor.locator(`[data-service-category="${id}"]`);
      await row
        .locator("input[type=file]")
        .setInputFiles("public/images/hair.jpg");
      await row
        .getByLabel("Альтернативный текст", { exact: true })
        .fill("Фото " + id);
      await row
        .getByLabel("Подпись над заголовком", { exact: true })
        .fill("Подпись " + id);
      await row
        .getByLabel("Заголовок поверх фото", { exact: true })
        .fill("Заголовок " + id);
      await expect(row.locator(".image-editor-overlay")).toContainText(
        "Заголовок " + id,
      );
    }
    expect(await call<SiteContent>("get_site_content_admin")).toEqual(original);
    await editor
      .getByRole("button", { name: "Сохранить блок услуг", exact: true })
      .click();
    await expect(
      page.getByText("Контент сохранён. Изображения доступны посетителям.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 45000 });
    const saved = await call<SiteContent>("get_site_content_admin");
    expect(
      new Set(
        saved.items
          .filter((i) => i.kind === "service_category")
          .map((i) => i.assetId),
      ).size,
    ).toBe(5);
    const publicPage = await visitor.newPage();
    await publicPage.route("https://yandex.ru/map-widget/**", (r) => r.abort());
    await publicPage.goto("/");
    const block = publicPage.locator("#services");
    await expect(block.locator(".eyebrow")).toHaveText("Ритуалы владельца");
    await expect(block.locator("h2 em")).toHaveText("для вас");
    await expect(block.locator(".heading-aside")).toHaveText(
      "Описание без <b>HTML</b>",
    );
    await expect(block.locator(".heading-aside b")).toHaveCount(0);
    for (const [id, label] of Object.entries(categories)) {
      await publicPage.getByRole("tab", { name: label, exact: true }).click();
      await expect(block.locator(".service-photo img")).toHaveAttribute(
        "alt",
        "Фото " + id,
      );
      const assetId = saved.items.find(
        (i) => i.id === "category:" + id,
      )!.assetId!;
      await expect(block.locator(".service-photo img")).toHaveAttribute(
        "src",
        new RegExp(assetId),
      );
      const image = await publicPage.request.get(
        "http://127.0.0.1:15329/functions/v1/site-media?id=" + assetId,
      );
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toContain("image/webp");
      await expect(block.locator(".service-photo p")).toHaveText(
        "Заголовок " + id,
      );
      await expect(block.locator(".service-photo span")).toHaveText(
        "Подпись " + id,
      );
      await expect(block.locator(".service-footnote")).toHaveText(
        "Примечание владельца",
      );
      await expect
        .poll(() =>
          block
            .locator(".service-photo img")
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    expect(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await block.screenshot({ path: "test-results/service-block-mobile.png" });
    await page.reload();
    await page
      .getByRole("button", { name: "Контент сайта", exact: true })
      .click();
    await expect(
      editor.getByLabel("Надзаголовок", { exact: true }),
    ).toHaveValue("Ритуалы владельца");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const hair = editor.locator('[data-service-category="hair"]');
    await hair
      .locator("input[type=file]")
      .setInputFiles("public/images/nails.jpg");
    await page.route("**/functions/v1/site-media?action=upload", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"UPLOAD_FAILED"}',
      }),
    );
    await editor
      .getByRole("button", { name: "Сохранить блок услуг", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Старое изображение сохранено",
    );
    expect(await call<SiteContent>("get_site_content_admin")).toEqual(saved);
    // Removing a failed/uncommitted file must clear its File object as well.
    // The upload endpoint still fails; this save must succeed without uploading.
    await hair
      .getByRole("button", { name: "Убрать изображение", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Сохранить блок услуг", exact: true })
      .click();
    await expect(
      editor.getByRole("button", { name: "Сохранить блок услуг", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".media-progress")).toHaveCount(0);
    expect(
      (await call<SiteContent>("get_site_content_admin")).items.find(
        (i) => i.id === "category:hair",
      ),
    ).toMatchObject({ assetId: null, legacySrc: "" });
  } finally {
    await visitor.close();
    // Legacy sources cannot be reintroduced through the browser API; local test
    // instances are disposable. Preserve the newly uploaded bindings in cleanup.
  }
});

test("empty categories hide, selection moves to first active category, all-empty is honest", async ({
  page,
  request,
}) => {
  const call = await api(request);
  const original = await call<AppData>("get_admin_snapshot");
  const save = async (services: AppData["services"]) => {
    const data = await call<AppData>("get_admin_snapshot");
    return call<AppData>("admin_apply_changes", {
      p_changes: { services },
      p_expected_revision: data.revision,
    });
  };
  try {
    await page.goto("/");
    await page.getByRole("tab", { name: "Волосы", exact: true }).click();
    await save(
      original.services.map((s) =>
        s.category === "hair" ? { ...s, active: false } : s,
      ),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("tab", { name: "Волосы", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Ногти", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await save(original.services);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("tab", { name: "Волосы", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Ногти", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await save(original.services.map((s) => ({ ...s, active: false })));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("#services")).toContainText(
      "Пока нет доступных услуг",
    );
    await expect(page.locator("#services [role=tab]")).toHaveCount(0);
    await expect(page.locator("#services .service-row")).toHaveCount(0);
    await login(page);
    await page
      .getByRole("button", { name: "Контент сайта", exact: true })
      .click();
    await expect(page.locator("[data-service-category]")).toHaveCount(5);
  } finally {
    await save(original.services);
  }
});
