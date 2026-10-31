import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { AppData } from "../src/types";

async function adminApi(request: APIRequestContext) {
  const session = await (
    await request.post("http://127.0.0.1:54329/auth/v1/token", {
      data: { email: "admin@example.test", password: "TestingOnly123!" },
    })
  ).json();
  return async <T>(name: string, data = {}): Promise<T> => {
    const response = await request.post(
      `http://127.0.0.1:54329/rest/v1/rpc/${name}`,
      { headers: { Authorization: `Bearer ${session.access_token}` }, data },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
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
async function validAnchors(page: Page) {
  const missing = await page
    .locator('a[href^="/#"], a[href^="#"]')
    .evaluateAll((links) =>
      links
        .map((link) => new URL((link as HTMLAnchorElement).href).hash.slice(1))
        .filter((id) => id && !document.getElementById(id)),
    );
  expect(missing).toEqual([]);
}

test("empty sections have no navigation; owner confirms a profile and a guest can book it", async ({
  page,
  request,
  browser,
}) => {
  const call = await adminApi(request);
  const original = await call<AppData>("get_admin_snapshot");
  const save = (data: AppData, masters: AppData["masters"]) =>
    call<AppData>("admin_apply_changes", {
      p_changes: { masters },
      p_expected_revision: data.revision,
      p_allow_conflicts: false,
    });
  try {
    await save(
      original,
      original.masters.map((m) => ({ ...m, published: false, specialty: m.id === 'aida' ? 'Авторская специализация владельца' : m.specialty })),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://yandex.ru/map-widget/**", route => route.fulfill({contentType:"text/html",body:"<p>Test map widget</p>"}));
    await page.goto("/");
    await expect(page.locator("#masters")).toHaveCount(0);
    await expect(page.locator("#portfolio")).toHaveCount(0);
    await expect(page.locator(".reviews-section")).toHaveCount(0);
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
    await expect(
      page.getByText("Демонстрационные профили мастеров."),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Основная навигация" })
        .getByRole("link", { name: "Мастера", exact: true }),
    ).toHaveCount(0);
    await validAnchors(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".location-map")).toContainText(
      "Проспект Манаса, 38 / Киевская улица, 164",
    );
    await expect(page.locator(".location-map iframe")).toHaveAttribute("src",/74\.587887.*42\.875068/);
    await expect(page.locator(".location-map a")).toHaveAttribute("href","https://2gis.kg/bishkek/geo/15763234351108741/74.587887,42.875068");

    await login(page);
    await page.getByRole("button", { name: "Мастера", exact: true }).click();
    await page.getByRole('button', {name: 'Добавить мастера', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', {name: 'Показывать мастера на сайте и разрешить онлайн-запись', exact: true})).toBeVisible();
    await expect(dialog.getByRole('checkbox', {name: 'Показывать мастера на сайте и разрешить онлайн-запись', exact: true})).not.toBeChecked();
    await expect(dialog.getByRole('combobox', {name:'Специализация', exact: true})).toBeVisible();
    await dialog.getByRole('combobox', {name:'Специализация', exact: true}).selectOption('Мастер маникюра');
    await expect(dialog.getByRole('group', {name:'Услуги мастера',exact:true}).getByRole('checkbox').first()).not.toBeChecked();
    await dialog.getByRole('button', {name:'Закрыть',exact:true}).click();
    const card = page
      .locator(".admin-master-card")
      .filter({
        has: page.getByRole("heading", { name: "Аида", exact: true }),
      });
    await expect(card).toContainText("Не опубликован");
    await card.getByRole("button", { name: "Профиль и график" }).click();
    const initialSnapshot = await call<AppData>("get_admin_snapshot");
    const initialMaster = initialSnapshot.masters.find(m => m.id === "aida")!;
    expect(initialMaster.published).toBe(false);
    await expect(page.getByRole("heading", { name: "Публикация на сайте", exact: true })).toBeInViewport();
    await expect(page.getByRole('combobox', {name:'Специализация',exact:true})).toHaveValue('Авторская специализация владельца');
    const publication = page.getByRole("dialog").getByRole("checkbox", { name: 'Показывать мастера на сайте и разрешить онлайн-запись', exact: true });
    await expect(publication).not.toBeChecked();
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: 'Показывать мастера на сайте и разрешить онлайн-запись', exact: true })
      .check();
    // A checkbox in a draft must not publish until the existing save transaction.
    expect((await call<AppData>("get_public_catalog")).masters).toHaveLength(0);
    const savedRequest = page.waitForRequest(request => request.url().endsWith("/rest/v1/rpc/admin_apply_changes") && request.method() === "POST");
    await page
      .getByRole("button", { name: "Сохранить мастера", exact: true })
      .click();
    const sent = (await savedRequest).postDataJSON();
    expect(sent.p_changes.masters.find((m: {id: string}) => m.id === "aida").published).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const savedSnapshot = await call<AppData>("get_admin_snapshot");
    const savedMaster = savedSnapshot.masters.find(m => m.id === "aida")!;
    expect(savedMaster).toMatchObject({
      id: initialMaster.id, published: true, specialty: initialMaster.specialty, serviceIds: initialMaster.serviceIds,
      days: initialMaster.days, start: initialMaster.start, end: initialMaster.end,
      breakStart: initialMaster.breakStart, breakEnd: initialMaster.breakEnd,
      daysOff: initialMaster.daysOff, vacationStart: initialMaster.vacationStart,
      vacationEnd: initialMaster.vacationEnd, photo: initialMaster.photo,
      photoAssetId: initialMaster.photoAssetId, photoAlt: initialMaster.photoAlt,
    });
    expect(savedSnapshot.appointments).toEqual(initialSnapshot.appointments);
    await expect(card).toContainText("Опубликован · доступен для записи");
    await card.getByRole("button", { name: "Профиль и график" }).click();
    await expect(publication).toBeChecked();
    await page.getByRole("dialog").getByRole("button", {name: "Закрыть",exact:true}).click();
    await page.reload();
    await page.getByRole("button", { name: "Мастера", exact: true }).click();
    await card.getByRole("button", { name: "Профиль и график" }).click();
    await expect(publication).toBeChecked();
    await page.getByRole("dialog").screenshot({path:"test-results/master-publication-mobile.png"});
    await page.getByRole("dialog").getByRole("button", {name: "Закрыть",exact:true}).click();

    const visitor = await browser.newContext({
      baseURL: "http://127.0.0.1:5175",
      viewport: { width: 390, height: 844 },
    });
    try {
      const publicPage = await visitor.newPage();
      await publicPage.route("https://yandex.ru/map-widget/**",route => route.abort());
      await publicPage.route(
        "https://challenges.cloudflare.com/turnstile/v0/api.js*",
        (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `window.turnstile={render(container,options){setTimeout(()=>options.callback('TEST_CAPTCHA_'+crypto.randomUUID()),10);return 'test';},remove(){}};`,
          }),
      );
      await publicPage.goto("/");
      await expect(publicPage.locator(".master-card")).toHaveCount(1);
      await expect(publicPage.locator(".master-card h3")).toHaveText("Аида");
      await validAnchors(publicPage);
      await publicPage
        .locator(".slot-card")
        .first()
        .getByRole("button", { name: "Записаться", exact: true })
        .click();
      const dialog = publicPage.getByRole("dialog");
      await dialog
        .getByLabel("Имя", { exact: true })
        .fill("Тест опубликованного мастера");
      await dialog.getByLabel("Телефон", { exact: true }).fill("+996000000089");
      await dialog.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "Подтвердить запись", exact: true })
        .click();
      await expect(
        dialog.getByRole("heading", { name: "Ваше время — для вас." }),
      ).toBeVisible();
      const data = await call<AppData>("get_admin_snapshot");
      const visit = data.appointments.find(
        (a) => a.clientName === "Тест опубликованного мастера",
      )!;
      expect(visit.masterId).toBe("aida");
      await call("cancel_appointment", {
        p_id: visit.id,
        p_manage_token: null,
        p_request_id: crypto.randomUUID(),
        p_expected_version: visit.version,
      });
    } finally {
      await visitor.close();
    }
  } finally {
    const current = await call<AppData>("get_admin_snapshot");
    await save(
      current,
      current.masters.map((m) => ({
        ...m,
        specialty: original.masters.find(old => old.id === m.id)?.specialty || m.specialty,
        published:
          original.masters.find((old) => old.id === m.id)?.published || false,
      })),
    );
  }
});

test("existing settings control the address and interactive embed; links survive a map failure", async ({
  page,
  request,
}) => {
  const call = await adminApi(request);
  const original = await call<AppData>("get_admin_snapshot");
  try {
    await login(page);
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page
      .getByLabel("Адрес", { exact: true })
      .fill("Бишкек, адрес для проверки настроек");
    const map = "https://yandex.ru/maps/?text=test";
    const embed = "https://yandex.ru/map-widget/v1/?text=test";
    await page
      .getByLabel("Описание здания", { exact: true })
      .fill("Описание здания владельца");
    await page
      .getByLabel("Ссылка на здание / маршрут", { exact: true })
      .fill(map);
    await page
      .getByLabel("Ссылка встроенной карты", { exact: true })
      .fill(embed);
    await page.getByRole("checkbox", { name: /Подтверждаю: адрес/ }).check();
    await page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(
      page.getByText("Настройки салона сохранены.", { exact: true }),
    ).toBeVisible();
    await page.route("https://yandex.ru/map-widget/**", (route) =>
      route.abort(),
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const location = page.locator(".location-map");
    await expect(location).toContainText("Бишкек, адрес для проверки настроек");
    await expect(location).toContainText("Описание здания владельца");
    await expect(
      location.getByRole("link", { name: "Построить маршрут" }),
    ).toHaveAttribute("href", map);
    await expect(location.locator("iframe")).toHaveAttribute("src", embed);
    await location.scrollIntoViewIfNeeded();
    await expect(
      location.getByRole("link", { name: "Построить маршрут" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await expect(location).toContainText("Бишкек, адрес для проверки настроек");
  } finally {
    const current = await call<AppData>("get_admin_snapshot");
    await call("admin_apply_changes", {
      p_changes: { settings: original.settings },
      p_expected_revision: current.revision,
      p_allow_conflicts: false,
    });
  }
});
