import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function login(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("TestingOnly123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Разделы админ-панели" }),
  ).toBeVisible();
}
const section = (page: Page, name: string) =>
  page
    .locator(".content-section")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
test("admin uploads, crops, replaces and removes photos; drafts stay private and visitors see saved changes", async ({
  page,
  browser,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  const hero = section(page, "Главное фото");
  await expect(hero.locator('input[type="file"]')).toBeEnabled();
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto("http://127.0.0.1:5175/");
  const before = await publicPage
    .locator(".hero-visual > img")
    .getAttribute("src");
  await hero
    .locator('input[type="file"]')
    .setInputFiles("public/images/hair.jpg");
  await expect(
    hero.getByRole("checkbox", { name: "Обрезать под пропорции блока" }),
  ).toBeVisible();
  await hero
    .getByRole("checkbox", { name: "Обрезать под пропорции блока" })
    .check();
  await hero.getByLabel("Масштаб", { exact: true }).fill("1.3");
  await hero
    .getByLabel("Альтернативный текст")
    .fill("Новое главное фото салона");
  await expect(hero.locator(".image-editor-preview img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await publicPage.reload();
  await expect(publicPage.locator(".hero-visual > img")).toHaveAttribute(
    "src",
    before!,
  );
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Сохранить контент", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Контент сохранён. Изображения доступны посетителям.", {
      exact: true,
    }),
  ).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.locator(".hero-visual > img")).toHaveAttribute(
    "alt",
    "Новое главное фото салона",
  );
  const first = await publicPage
    .locator(".hero-visual > img")
    .getAttribute("src");
  expect(first).toContain("/functions/v1/site-media?id=");
  await publicPage
    .locator(".hero-visual > img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
    });
  await hero
    .locator('input[type="file"]')
    .setInputFiles("public/images/nails.jpg");
  await page.route("**/functions/v1/site-media?action=upload", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"UPLOAD_FAILED"}',
    }),
  );
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Старое изображение сохранено",
  );
  await publicPage.reload();
  await expect(publicPage.locator(".hero-visual > img")).toHaveAttribute(
    "src",
    first!,
  );
  await page.unroute("**/functions/v1/site-media?action=upload");
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(
    page.getByText("Контент сохранён. Изображения доступны посетителям.", {
      exact: true,
    }),
  ).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.locator(".hero-visual > img")).not.toHaveAttribute(
    "src",
    first!,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  await expect(hero.getByLabel("Альтернативный текст")).toHaveValue(
    "Новое главное фото салона",
  );
  await hero
    .getByRole("button", { name: "Убрать изображение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(
    page.getByText("Контент сохранён. Изображения доступны посетителям.", {
      exact: true,
    }),
  ).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.locator(".hero-visual > img")).toHaveAttribute(
    "src",
    /^data:image/,
  );
  await visitor.close();
});
test("portfolio ordering/hiding persists, concurrent edit is rejected, content editor fits a phone", async ({
  page,
  browser,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  const portfolio = section(page, "Портфолио работ");
  await expect(
    portfolio.getByRole("button", { name: "Добавить фото", exact: true }),
  ).toBeEnabled();
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:5175" });
  const second = await other.newPage();
  await login(second);
  await second
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  await expect(
    section(second, "Главное фото").getByLabel("Альтернативный текст"),
  ).toBeEnabled();
  await portfolio
    .getByRole("button", { name: "Добавить фото", exact: true })
    .click();
  let card = portfolio.locator(".content-image-card").last();
  await card
    .locator('input[type="file"]')
    .setInputFiles("public/images/nails.jpg");
  await card.getByLabel("Подпись", { exact: true }).fill("Мобильная работа");
  await card.getByLabel("Категория", { exact: true }).fill("Маникюр");
  await card.getByLabel("Альтернативный текст").fill("Маникюр с акцентами");
  const count = await portfolio.locator(".content-image-card").count();
  for (let i = count - 1; i > 0; i--)
    await portfolio
      .locator(".content-image-card")
      .nth(i)
      .getByRole("button", { name: /Переместить фото .* выше/ })
      .click();
  card = portfolio.locator(".content-image-card").first();
  await expect(card.getByLabel("Подпись", { exact: true })).toHaveValue(
    "Мобильная работа",
  );
  await portfolio
    .locator(".content-image-card")
    .nth(1)
    .getByRole("checkbox", { name: "Показывать на сайте" })
    .uncheck();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/content-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(
    page.getByText("Контент сохранён. Изображения доступны посетителям.", {
      exact: true,
    }),
  ).toBeVisible();
  await section(second, "Главное фото")
    .getByLabel("Альтернативный текст")
    .fill("Устаревший черновик");
  await second
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(second.getByRole("alert")).toContainText(
    "Другой администратор уже изменил контент",
  );
  await page.goto("/");
  await expect(page.locator(".portfolio-card").first()).toContainText(
    "Мобильная работа",
  );
  // Only the owner-uploaded work is public; legacy examples remain in admin.
  await expect(page.locator(".portfolio-card")).toHaveCount(1);
  await other.close();
});
test("master photo is saved from the existing profile form and direct media requests enforce auth", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page.getByRole("button", { name: "Мастера", exact: true }).click();
  await page.locator(".admin-master-card").first().getByRole("button", { name: "Профиль и график" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles("public/images/master-aida.jpg");
  await dialog
    .getByLabel("Альтернативный текст")
    .fill("Обновлённый портрет мастера");
  await dialog
    .getByRole("button", { name: "Сохранить мастера", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/");
  await expect(page.locator("#masters img").first()).toHaveAttribute(
    "alt",
    "Обновлённый портрет мастера",
  );
  const endpoint = "http://127.0.0.1:15329/functions/v1/site-media";
  const bytes = readFileSync("public/images/nails.jpg");
  expect(
    (
      await request.post(endpoint + "?action=upload", {
        data: bytes,
        headers: { "Content-Type": "image/jpeg" },
      })
    ).status(),
  ).toBe(401);
  const viewer = await (
    await request.post("http://127.0.0.1:15329/auth/v1/token", {
      data: { email: "viewer@example.test", password: "TestingOnly123!" },
    })
  ).json();
  for (const action of ["upload", "cleanup"]) {
    const result = await request.post(endpoint + "?action=" + action, {
      data: bytes,
      headers: {
        "Content-Type": "image/jpeg",
        Authorization: `Bearer ${viewer.access_token}`,
      },
    });
    expect(result.status()).toBe(403);
  }
});

test("logo and salon gallery use saved bindings; portfolio deletion is explicit", async ({
  page,
  browser,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  const logo = section(page, "Логотип");
  const salon = section(page, "Фотографии салона");
  const portfolio = section(page, "Портфолио работ");
  await expect(logo.locator('input[type="file"]')).toBeEnabled();
  await logo
    .locator('input[type="file"]')
    .setInputFiles("public/images/nails.jpg");
  await logo.getByLabel("Альтернативный текст").fill("Логотип салона");
  await salon
    .getByRole("button", { name: "Добавить фото", exact: true })
    .click();
  const newSalon = salon.locator(".content-image-card").last();
  await newSalon
    .locator('input[type="file"]')
    .setInputFiles("public/images/hair.jpg");
  await newSalon
    .getByLabel("Альтернативный текст")
    .fill("Второй снимок салона");
  await newSalon
    .getByRole("button", { name: /Переместить фото .* выше/ })
    .click();
  await salon
    .locator(".content-image-card")
    .first()
    .getByRole("button", { name: "Перетащить фото 1", exact: true })
    .dragTo(
      salon
        .locator(".content-image-card")
        .last()
        .getByRole("button", { name: "Перетащить фото 2", exact: true }),
    );
  await expect(
    salon
      .locator(".content-image-card")
      .last()
      .getByLabel("Альтернативный текст"),
  ).toHaveValue("Второй снимок салона");
  await salon
    .locator(".content-image-card")
    .last()
    .getByRole("button", { name: /Переместить фото .* выше/ })
    .click();
  const count = await portfolio.locator(".content-image-card").count();
  await portfolio
    .locator(".content-image-card")
    .last()
    .getByRole("button", { name: "Удалить элемент", exact: true })
    .click();
  await expect(portfolio.locator(".content-image-card")).toHaveCount(count - 1);
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(
    page.getByText("Контент сохранён. Изображения доступны посетителям.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".media-progress")).toHaveCount(0);
  const visitor = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const publicPage = await visitor.newPage();
  await publicPage.goto("http://127.0.0.1:5175/");
  await expect(publicPage.locator(".header-inner .brand-logo")).toHaveAttribute(
    "alt",
    "Логотип салона",
  );
  await expect(publicPage.locator(".about-image > img")).toHaveAttribute(
    "alt",
    "Второй снимок салона",
  );
  await publicPage
    .getByRole("button", { name: "Следующее фото салона", exact: true })
    .click();
  await expect(publicPage.locator(".about-image > img")).not.toHaveAttribute(
    "alt",
    "Второй снимок салона",
  );
  await expect(publicPage.locator(".salon-photo-controls span")).toHaveText(
    "2 / 2",
  );
  expect(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await logo
    .getByRole("button", { name: "Убрать изображение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить контент", exact: true })
    .click();
  await expect(page.locator(".media-progress")).toHaveCount(0);
  await publicPage.reload();
  await expect(publicPage.locator(".header-inner .brand-logo")).toHaveCount(0);
  await expect(publicPage.locator(".header-inner .brand")).toContainText(
    "AURA",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Контент сайта", exact: true })
    .click();
  await expect(portfolio.locator(".content-image-card")).toHaveCount(count - 1);
  await visitor.close();
});
