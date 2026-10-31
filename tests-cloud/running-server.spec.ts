// Opt-in check of the owner's existing Vite server. All backend traffic is
// intercepted and redirected to the disposable fixture; never writes to cloud.
import { test, expect } from '@playwright/test';
import { loadEnv } from 'vite';

test('actual server 5173 serves publication and specialty controls in both forms', async ({browser}) => {
  test.skip(process.env.RUNNING_APP_CHECK !== '1', 'Requires the owner dev server on 5173');
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const backend = new URL(env.VITE_SUPABASE_URL).origin;
  const context = await browser.newContext({baseURL:'http://127.0.0.1:5173', viewport:{width:390,height:844}, serviceWorkers:'block'});
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:5173') return route.continue();
      if (url.origin !== backend) return route.abort();
      // Never continue requests to the actual backend, including unknown paths.
      if (!/^\/(auth|rest|functions)\/v1\//.test(url.pathname)) return route.abort();
      const response = await route.fetch({url:'http://127.0.0.1:54329'+url.pathname+url.search,
        headers:{...route.request().headers(), apikey:'sb_publishable_TEST_ONLY', origin:'http://127.0.0.1:5175'}});
      await route.fulfill({response, headers:{...response.headers(),'access-control-allow-origin':'http://127.0.0.1:5173'}});
    });
    const page = await context.newPage();
    await page.goto('/admin');
    await page.getByLabel('Email',{exact:true}).fill('admin@example.test');
    await page.getByLabel('Пароль',{exact:true}).fill('TestingOnly123!');
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.getByRole('button',{name:'Мастера',exact:true}).click();
    for (const mode of ['new','edit']) {
      if (mode === 'new') await page.getByRole('button',{name:'Добавить мастера',exact:true}).click();
      else await page.locator('.admin-master-card').first().getByRole('button',{name:'Профиль и график'}).click();
      const dialog = page.getByRole('dialog');
      const checkbox = dialog.getByRole('checkbox',{name:'Показывать мастера на сайте и разрешить онлайн-запись',exact:true});
      await expect(checkbox).toBeInViewport();
      await expect(dialog.getByRole('combobox',{name:'Специализация',exact:true})).toBeVisible();
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await dialog.screenshot({path:`test-results/running-5173-${mode}.png`});
      await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
    }
  } finally { await context.close(); }
});
