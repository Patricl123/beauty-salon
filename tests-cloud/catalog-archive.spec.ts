import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { AppData, Appointment } from "../src/types";
import { addDays, today } from "../src/lib/schedule";

const api = "http://127.0.0.1:54329";
async function adminApi(request: APIRequestContext) {
  const session = await (
    await request.post(`${api}/auth/v1/token?grant_type=password`, {
      data: { email: "admin@example.test", password: "TestingOnly123!" },
    })
  ).json();
  return async <T>(name: string, data = {}): Promise<T> => {
    const response = await request.post(`${api}/rest/v1/rpc/${name}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data,
    });
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
const entry = (page: Page, kind: string, name: string) =>
  page
    .locator(kind === "master" ? ".admin-master-card" : "tbody tr")
    .filter({ hasText: name });

for (const kind of ["master", "service"] as const) {
  test(`${kind}: creates in the form, archives, restores and confirms permanent deletion without visits`, async ({
    page,
    request,
  }) => {
    if (kind === "service")
      await page.setViewportSize({ width: 390, height: 844 });
    const call = await adminApi(request);
    const name = `Тест удаления ${kind}`;
    await login(page);
    await page
      .getByRole("button", {
        name: kind === "master" ? "Мастера" : "Услуги",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: kind === "master" ? "Добавить мастера" : "Добавить услугу",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(kind === "master" ? "Имя" : "Название", { exact: true })
      .fill(name);
    if (kind === "master")
      await dialog
        .getByLabel("Специализация", { exact: true })
        .fill("Тестовый профиль");
    await dialog
      .getByRole("button", {
        name: kind === "master" ? "Сохранить мастера" : "Сохранить услугу",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    const row = entry(page, kind, name);
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(dialog).toContainText("Связанных записей нет");
    await dialog
      .getByRole("button", { name: "Закрыть", exact: true })
      .last()
      .click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    await dialog.getByRole("button", { name: "В архив", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Архив", exact: true }).click();
    await expect(row).toBeVisible();
    const publicData = await call<AppData>("get_public_catalog");
    expect(
      (kind === "master" ? publicData.masters : publicData.services).some(
        (item) => item.name === name,
      ),
    ).toBe(false);
    await row
      .getByRole("button", { name: "Восстановить", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Подтвердить восстановление", exact: true })
      .click();
    await page.getByRole("button", { name: "Текущие", exact: true }).click();
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Подтвердить удаление", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", {
        name: kind === "master" ? "Мастера" : "Услуги",
        exact: true,
      })
      .click();
    await expect(row).toHaveCount(0);
    const snapshot = await call<AppData>("get_admin_snapshot");
    expect(
      (kind === "master" ? snapshot.masters : snapshot.services).some(
        (item) => item.name === name,
      ),
    ).toBe(false);
  });
}

test("future visits block both actions; cancelled history offers archive and survives restoration", async ({
  page,
  request,
}) => {
  const call = await adminApi(request);
  const initial = await call<AppData>("get_admin_snapshot");
  const master = {
    ...initial.masters.find((m) => m.id === "aida")!,
    id: "archive-browser-master",
    name: "Архивный тест мастер",
    photo: "",
    photoAssetId: null,
    photoVersion: 0,
    serviceIds: ["archive-browser-service"],
  };
  const service = {
    ...initial.services.find((s) => s.id === "haircut")!,
    id: "archive-browser-service",
    name: "Архивный тест услуга",
  };
  await call("admin_apply_changes", {
    p_changes: { masters: [master], services: [service] },
    p_expected_revision: initial.revision,
    p_allow_conflicts: false,
  });
  const a = await call<Appointment>("create_appointment", {
    p_request_id: crypto.randomUUID(),
    p_manage_token: "d".repeat(64),
    p_payload: {
      serviceId: service.id,
      masterId: master.id,
      date: addDays(today(), 3),
      time: "10:00",
      clientName: "Клиент архива",
      phone: "+996000000077",
      comment: "",
      expectedPrice: service.price,
      expectedDuration: service.duration,
      consent: true,
    },
  });
  await login(page);
  for (const kind of ["master", "service"]) {
    await page
      .getByRole("button", {
        name: kind === "master" ? "Мастера" : "Услуги",
        exact: true,
      })
      .click();
    await entry(page, kind, kind === "master" ? master.name : service.name)
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("неотменённых записей: 1");
    await expect(
      dialog.getByRole("button", { name: "В архив", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Подтвердить удаление", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Закрыть", exact: true })
      .last()
      .click();
  }
  expect(
    (await call<AppData>("get_admin_snapshot")).appointments.find(
      (x) => x.id === a.id,
    )?.status,
  ).toBe("pending");
  await call("cancel_appointment", {
    p_id: a.id,
    p_manage_token: null,
    p_request_id: crypto.randomUUID(),
    p_expected_version: a.version,
  });
  for (const kind of ["master", "service"]) {
    await page
      .getByRole("button", {
        name: kind === "master" ? "Мастера" : "Услуги",
        exact: true,
      })
      .click();
    const row = entry(
      page,
      kind,
      kind === "master" ? master.name : service.name,
    );
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Связанных записей: 1");
    await expect(
      dialog.getByRole("button", { name: "Подтвердить удаление", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "В архив", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Архив", exact: true }).click();
    await row
      .getByRole("button", { name: "Восстановить", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Подтвердить восстановление", exact: true })
      .click();
  }
  const snapshot = await call<AppData>("get_admin_snapshot");
  expect(snapshot.appointments.find((x) => x.id === a.id)?.status).toBe(
    "cancelled",
  );
  expect(snapshot.masters.find((m) => m.id === master.id)?.archived).toBe(
    false,
  );
  expect(snapshot.services.find((s) => s.id === service.id)?.archived).toBe(
    false,
  );
});
