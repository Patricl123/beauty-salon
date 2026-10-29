import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  // Browser-only fixture; production code has no CAPTCHA bypass or test switch.
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js*",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile = { render(container, options) { container.textContent = 'Проверка защиты'; setTimeout(() => options.callback('TEST_CAPTCHA_' + crypto.randomUUID()), 10); return 'test'; }, remove() {} };`,
      }),
  );
});
test("a public form cannot submit without completing the CAPTCHA", async ({
  page,
  request,
}) => {
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js*",
    (route) => route.abort(),
  );
  const before = await (
    await request.get("http://127.0.0.1:54329/__test/stats")
  ).json();
  await page.goto("/");
  await page
    .locator(".slot-card")
    .first()
    .getByRole("button", { name: "Записаться", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Имя", { exact: true }).fill("Проверка защиты");
  await dialog.getByLabel("Телефон", { exact: true }).fill("+996000000054");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Подтвердить запись", exact: true })
    .click();
  await expect(
    dialog.getByText("Пройдите проверку защиты от ботов перед записью.", {
      exact: true,
    }),
  ).toBeVisible();
  const after = await (
    await request.get("http://127.0.0.1:54329/__test/stats")
  ).json();
  expect(after.appointments).toBe(before.appointments);
  expect(after.calls.create_appointment || 0).toBe(
    before.calls.create_appointment || 0,
  );
});
test("real login form denies a non-admin and accepts a provisioned administrator", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Войти в демо админ-панели")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("viewer@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("TestingOnly123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByText("У этой учётной записи нет прав администратора.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("TestingOnly123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Разделы админ-панели" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Услуги", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Редактировать: Стрижка и укладка",
      exact: true,
    })
    .click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Цена, сом").fill("2500");
  await edit.getByRole("button", { name: "Сохранить услугу" }).click();
  await expect(edit).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Услуги", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Редактировать: Стрижка и укладка",
      exact: true,
    })
    .click();
  await expect(edit.getByLabel("Цена, сом")).toHaveValue("2500");
  await edit.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByText("Сбросить демоданные", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
});
test("lost create response can be retried without duplication, then moved and cancelled", async ({
  page,
  request,
}) => {
  const before = await (
    await request.get("http://127.0.0.1:54329/__test/stats")
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .locator(".slot-card")
    .first()
    .getByRole("button", { name: "Записаться", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Имя", { exact: true }).fill("Серверный тест");
  await dialog.getByLabel("Телефон", { exact: true }).fill("+996000000055");
  await dialog.getByRole("checkbox").check();
  let loseResponse = true;
  await page.route("**/functions/v1/booking-gateway", async (route) => {
    if (loseResponse && route.request().postDataJSON().operation === "create") {
      loseResponse = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Подтвердить запись", exact: true })
    .click();
  await expect(
    dialog
      .getByText("Не удалось подтвердить запрос.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Подтвердить запись", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Ваше время — для вас." }),
  ).toBeVisible();
  const after = await (
    await request.get("http://127.0.0.1:54329/__test/stats")
  ).json();
  expect(after.appointments - before.appointments).toBe(1);
  expect(
    after.calls.create_appointment - (before.calls.create_appointment || 0),
  ).toBe(2);
  expect(
    await page.evaluate(() => localStorage.getItem("aura-beauty-demo-v1")),
  ).toBeNull();
  await dialog.getByText("Код для переноса и отмены", { exact: true }).click();
  const code = await dialog.getByLabel("Персональный код").inputValue();
  expect(code.length).toBe(101);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.goto("/bookings");
  await expect(page.locator(".appointment-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".appointment-card")).toHaveCount(1);
  await page
    .locator(".appointment-card")
    .getByRole("button", { name: "Перенести", exact: true })
    .click();
  await expect(
    dialog.locator(".time-grid button:not(:disabled)").first(),
  ).toBeVisible();
  await dialog.locator(".time-grid button:not(:disabled)").last().click();
  await dialog.getByRole("button", { name: "Продолжить", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Сохранить перенос", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Ваше время — для вас." }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Отменить запись", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Да, отменить", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Запись отменена" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("private APIs reject a visitor and another browser cannot list someone else’s appointments", async ({
  page,
  request,
}) => {
  const response = await request.post(
    "http://127.0.0.1:54329/rest/v1/rpc/get_admin_snapshot",
    { data: {}, headers: { apikey: "sb_publishable_TEST_ONLY" } },
  );
  expect(response.status()).toBe(403);
  await page.goto("/bookings");
  await expect(page.locator(".appointment-card")).toHaveCount(0);
  await page
    .getByLabel("Код управления записью")
    .fill("10000000-0000-4000-8000-000000000001." + "a".repeat(64));
  await page
    .getByRole("button", { name: "Открыть запись", exact: true })
    .click();
  await expect(
    page.getByText("Запись не найдена или код управления неверен.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/admin");
  await page.evaluate(() => localStorage.setItem("isAdmin", "true"));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
});
