import { test, expect } from '@playwright/test';
import { addDays, dateLabel, today } from '../src/lib/schedule';

test('gateway failure is an error, not empty availability; retry recovers', async ({page}) => {
  let fail = true;
  await page.route('**/functions/v1/booking-gateway', async route => {
    if (fail) await route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:{code:'PROTECTION_UNAVAILABLE'}})});
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#availability')).toContainText('Не удалось загрузить свободное время');
  await expect(page.getByText('Свободных окошек пока нет', {exact:true})).toHaveCount(0);
  fail = false;
  await page.getByRole('button', {name:'Повторить загрузку времени',exact:true}).click();
  await expect(page.locator('.slot-card').first()).toBeVisible();
  await page.getByRole('button', {name:'Записаться онлайн',exact:true}).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.service-choice').first().click();
  await dialog.getByRole('button', {name:/Выбрать дату и время/}).click();
  // The test must work after the salon closes, including on the last day of a month.
  const nextDay = addDays(today(), 1);
  if (nextDay.slice(0,7) !== today().slice(0,7))
    await dialog.getByRole('button', {name:'Следующий месяц',exact:true}).click();
  await dialog.getByRole('button', {name:dateLabel(nextDay,{day:'numeric',month:'long',year:'numeric'}),exact:true}).click();
  await expect(dialog.locator('.time-grid')).toBeVisible();
  fail = true;
  await dialog.getByRole('button', {name:'Назад',exact:true}).click();
  await dialog.locator('.master-choice').nth(1).click();
  await dialog.getByRole('button', {name:/Выбрать дату и время/}).click();
  await expect(dialog).toContainText('Не удалось загрузить свободное время');
  await expect(dialog.getByText('На этот день окошек нет', {exact:true})).toHaveCount(0);
  fail = false;
  await dialog.getByRole('button', {name:'Повторить загрузку времени',exact:true}).click();
  await expect(dialog.locator('.time-grid')).toBeVisible();
});

test('catalog failure is not reported as no masters or slots', async ({page}) => {
  await page.route('**/rest/v1/rpc/get_public_catalog', route => route.fulfill({status:503, contentType:'application/json', body:'{}'}));
  await page.goto('/');
  await expect(page.locator('#availability')).toContainText('Не удалось загрузить свободное время');
  await expect(page.getByText('Свободных окошек пока нет', {exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Записаться онлайн',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toContainText('Не удалось загрузить актуальный каталог');
  await expect(page.getByRole('dialog').getByText(/Пока нет мастеров|нет доступных услуг/)).toHaveCount(0);
  await page.unroute('**/rest/v1/rpc/get_public_catalog');
  await page.getByRole('dialog').getByRole('button',{name:'Повторить загрузку каталога',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.service-choice').first()).toBeVisible();
});
