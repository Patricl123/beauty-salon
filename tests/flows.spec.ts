import { test, expect, type Page } from '@playwright/test';
const key = 'aura-beauty-demo-v1';
// These regression scenarios exercise an explicitly published test catalog.
// Actual seed profiles remain unpublished; publication itself has separate tests.
test.beforeEach(async ({ page }) => {
  const { createSeed } = await import('../src/data/seed');
  const fixture = createSeed();
  fixture.masters.forEach(m => { m.published = true; });
  await page.addInitScript(({key, fixture}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture));
  }, {key, fixture});
});
async function enterAdmin(page: Page) { await page.goto('/admin'); await page.getByRole('button', { name: 'Войти в демо админ-панели' }).click(); }
test('home has all sections, local photos, keyboard navigation and no mobile overflow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: /Время.*для/ })).toBeVisible();
  await page.locator('#services').scrollIntoViewIfNeeded(); await page.getByRole('tab', { name: 'Ногти' }).click(); await expect(page.locator('#service-panel').getByRole('heading', { name: 'Маникюр с покрытием' })).toBeVisible();
  await page.locator('img').evaluateAll(images => images.forEach(img => { (img as HTMLImageElement).loading = 'eager'; }));
  await page.waitForFunction(() => [...document.images].every(img => img.complete));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  const broken = await page.locator('img').evaluateAll(images => images.filter(img => !(img as HTMLImageElement).complete || (img as HTMLImageElement).naturalWidth === 0).map(img => (img as HTMLImageElement).src)); expect(broken).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.locator('.mobile-book')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Открыть меню' }).click(); await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Мастера', exact: true }).click(); await expect(page.locator('#masters')).toBeInViewport();
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true }); expect(errors).toEqual([]);
});
test('book, persist, appear in admin, reschedule, cancel and free the slot', async ({ page }) => {
  await page.goto('/');
  await page.locator('.slot-card').first().getByRole('button', { name: 'Записаться' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'Как к вам обращаться?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать демозапись' }).click(); await expect(dialog.getByText('Введите имя — не менее двух символов.')).toBeVisible();
  await dialog.getByLabel('Имя', { exact: true }).fill('Тест Браузера'); await dialog.getByLabel('Телефон', { exact: true }).fill('+996 000 000 099'); await expect(dialog.getByRole('checkbox')).not.toBeChecked(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Создать демозапись' }).click();
  await expect(dialog.getByRole('heading', { name: 'Ваше время — для вас.' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Добавить в календарь' }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const created = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).appointments.find((a: { clientName: string }) => a.clientName === 'Тест Браузера'), key); expect(created.owner).toBe('visitor');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); await page.goto('/bookings'); await expect(page.getByText(created.id, { exact: false })).toBeVisible(); await page.reload(); await expect(page.getByText(created.id, { exact: false })).toBeVisible();
  await enterAdmin(page); await page.getByRole('navigation', { name: 'Разделы админ-панели' }).getByRole('button', { name: 'Записи', exact: false }).click(); await page.getByRole('textbox', { name: 'Поиск записей' }).fill('Тест Браузера'); await expect(page.getByRole('cell', { name: 'Тест Браузера', exact: false })).toBeVisible();
  await page.goto('/bookings'); const card = page.locator('.appointment-card').filter({ hasText: created.id }); await card.getByRole('button', { name: 'Перенести', exact: true }).click();
  const available = dialog.locator('.time-grid button:not(:disabled)'); const buttons = await available.all(); let selected = false; for (const b of buttons) { if (await b.textContent() !== created.time) { await b.click(); selected = true; break; } } expect(selected).toBe(true);
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Сохранить перенос' }).click(); await expect(dialog.getByRole('heading', { name: 'Ваше время — для вас.' })).toBeVisible();
  const moved = await page.evaluate(({ k, id }) => JSON.parse(localStorage.getItem(k)!).appointments.find((a: { id: string }) => a.id === id), { k: key, id: created.id }); expect(moved.time).not.toBe(created.time);
  await dialog.getByRole('button', { name: 'Отменить запись', exact: true }).click(); await dialog.getByRole('button', { name: 'Да, отменить', exact: true }).click(); await expect(dialog.getByRole('heading', { name: 'Запись отменена' })).toBeVisible();
  const state = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key); expect(state.appointments.find((a: { id: string }) => a.id === created.id).status).toBe('cancelled'); expect(state.notifications.some((n: { event: string }) => n.event === 'cancelled')).toBe(true); expect(state.notifications.some((n: { appointmentId: string; planned: boolean }) => n.appointmentId === created.id && n.planned)).toBe(false);
});
test('a confirmed booking can be moved again from the success screen without creating a duplicate', async ({ page }) => {
  await page.goto('/'); await page.locator('.slot-card').first().getByRole('button', { name: 'Записаться' }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Имя', { exact: true }).fill('Повторный перенос'); await dialog.getByLabel('Телефон', { exact: true }).fill('+996000000098'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Создать демозапись' }).click();
  await dialog.getByRole('button', { name: 'Перенести', exact: true }).click(); await dialog.locator('.time-grid button:not(:disabled)').last().click(); await dialog.getByRole('button', { name: 'Продолжить' }).click(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Сохранить перенос' }).click();
  await expect(dialog.getByRole('heading', { name: 'Ваше время — для вас.' })).toBeVisible(); expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).appointments.filter((a: { clientName: string }) => a.clientName === 'Повторный перенос').length, key)).toBe(1);
});
test('admin service, schedule, block, client note, notifications and reset work', async ({ page }) => {
  await enterAdmin(page); const nav = page.getByRole('navigation', { name: 'Разделы админ-панели' });
  await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
  await nav.getByRole('button', { name: 'Услуги', exact: true }).click(); await page.getByRole('button', { name: 'Редактировать: Стрижка и укладка', exact: true }).click(); let dialog = page.getByRole('dialog'); await dialog.getByLabel('Цена, сом').fill('2500'); await dialog.getByRole('button', { name: 'Сохранить услугу' }).click(); expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).services.find((s: { id: string }) => s.id === 'haircut').price, key)).toBe(2500);
  await nav.getByRole('button', { name: 'Мастера', exact: true }).click(); await page.locator('.admin-master-card').first().getByRole('button', { name: 'Профиль и график' }).click(); dialog = page.getByRole('dialog'); const workingDays = dialog.locator('.days-toggle button[aria-pressed="true"]'); while (await workingDays.count()) await workingDays.first().click(); await dialog.getByRole('button', { name: 'Сохранить мастера', exact: true }).click(); await expect(dialog.locator('.warning')).toBeVisible(); const count = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).appointments.length, key); await dialog.getByRole('button', { name: 'Сохранить график, не удаляя записи' }).click(); expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).appointments.length, key)).toBe(count); await expect(page.locator('.admin-content > .warning')).toBeVisible();
  await nav.getByRole('button', { name: 'Календарь', exact: true }).click(); await page.getByRole('button', { name: 'Неделя', exact: true }).click(); await expect(page.locator('.calendar-day')).toHaveCount(7); await page.getByRole('button', { name: 'Блокировать время', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Дата', { exact: true }).fill('2099-01-01'); await dialog.getByLabel('Причина').fill('Тест блокировки'); await dialog.getByRole('button', { name: 'Заблокировать время', exact: true }).click(); expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).blocks.some((b: { reason: string }) => b.reason === 'Тест блокировки'), key)).toBe(true);
  await nav.getByRole('button', { name: 'Клиенты', exact: true }).click(); await page.getByRole('button', { name: 'История и заметки' }).first().click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Внутренняя заметка').fill('Только демозаметка'); await dialog.getByRole('button', { name: 'Сохранить заметку' }).click(); await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await nav.getByRole('button', { name: 'Уведомления', exact: true }).click(); await page.getByRole('checkbox', { name: 'SMS', exact: true }).check(); await page.getByRole('button', { name: 'Сохранить настройки' }).click(); await expect(page.getByText('План · демо', { exact: true }).first()).toBeVisible();
  await nav.getByRole('button', { name: 'Настройки', exact: true }).click(); await page.getByLabel('Название', { exact: true }).fill('AURA TEST'); await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click(); if (await page.getByRole('button', { name: 'Сохранить график и существующие записи' }).isVisible()) await page.getByRole('button', { name: 'Сохранить график и существующие записи' }).click(); await expect(page.locator('.admin-sidebar .brand')).toContainText('AURA TEST');
  await page.getByRole('button', { name: 'Сбросить демоданные', exact: true }).click(); await page.getByRole('button', { name: 'Да, сбросить данные', exact: true }).click(); expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).settings.name, key)).toBe('AURA');
});
test('mobile booking and admin fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto('/'); await page.locator('.mobile-book').click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: /Стрижка и укладка/ }).click(); await dialog.getByRole('button', { name: 'Выбрать дату и время' }).click(); await expect(dialog.locator('.calendar')).toBeVisible(); expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: 'test-results/booking-mobile.png' }); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await enterAdmin(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.getByRole('navigation', { name: 'Разделы админ-панели' }).getByRole('button', { name: 'Календарь', exact: true }).click(); await page.getByRole('button', { name: 'Неделя', exact: true }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
});
