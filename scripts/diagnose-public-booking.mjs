// Read-only diagnostics. Prints no keys, tokens, names or appointment details.
import { loadEnv } from 'vite';
const env = { ...loadEnv('development', process.cwd(), 'VITE_'), ...process.env };
const origin = 'http://127.0.0.1:5173';
for (const path of ['/admin', '/src/components/AdminForms.tsx']) {
  try {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(10000) });
    const body = await res.text();
    console.log(JSON.stringify({ check: 'local', path, status: res.status,
      cacheControl: res.headers.get('cache-control'),
      devEntry: body.includes('/@vite/client'),
      publicationControl: body.includes('master-published'),
      specialtySelect: body.includes('master-specialty') && (body.includes('"select"') || body.includes('<select')),
    }));
  } catch { console.log(JSON.stringify({ check: 'local', path, unavailable: true })); }
}
if (process.argv.includes('--browser')) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage(); // Clean context, no admin session or guest tokens.
    const failures = [];
    page.on('pageerror', () => failures.push(true));
    await page.route('https://yandex.ru/map-widget/**', route => route.abort());
    const catalogResponse = page.waitForResponse(r => r.url().endsWith('/rest/v1/rpc/get_public_catalog'));
    await page.goto(origin);
    const response = await catalogResponse;
    await page.waitForFunction(() => !document.querySelector('#availability [role="status"]'));
    console.log(JSON.stringify({check:'real-public-browser', catalogStatus:response.status(),
      masterCards:await page.locator('.master-card').count(),
      catalogErrorVisible:await page.locator('.storage-error').count() > 0,
      nearestErrorVisible:await page.locator('#availability [role="alert"]').count() > 0,
      pageErrors:failures.length,
      serviceWorkers:await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    }));
  } finally { await browser.close(); }
}
if (!env.VITE_SUPABASE_URL || !/^sb_publishable_/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY || '')) {
  console.log('Public Supabase configuration unavailable; values not printed.');
  process.exitCode = 1;
} else {
  const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Origin: origin };
  async function request(path, body, method = 'POST') {
    const response = await fetch(env.VITE_SUPABASE_URL + path, {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    const code = result?.error?.code || result?.code;
    console.log(JSON.stringify({ check: path, method, status: response.status,
      allowedOrigin: response.headers.get('access-control-allow-origin'),
      ...(typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? { code } : {}),
      ...(path.endsWith('get_public_catalog') && response.ok ? {
        masters: result?.masters?.length, services: result?.services?.length,
        allMastersPublished: result?.masters?.length ? result.masters.every(m => m.published === true && !m.archived) : null,
      } : {}),
      ...(path.endsWith('booking-gateway') && response.ok && method === 'POST' ? {
        slots: Array.isArray(result?.data) ? result.data.length : undefined,
      } : {}),
    }));
    return response.ok ? result : null;
  }
  try {
    const catalog = await request('/rest/v1/rpc/get_public_catalog', {});
    await request('/functions/v1/booking-gateway', undefined, 'OPTIONS');
    const service = catalog?.services?.find(s => s.active && !s.archived);
    if (service) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      await request('/functions/v1/booking-gateway', { operation: 'slots', args: {
        p_service_id: service.id, p_master_id: 'any', p_date: date,
        p_exclude_id: null, p_manage_token: null,
      } });
    }
  } catch { console.log('Cloud request failed or timed out; error details withheld.'); process.exitCode = 1; }
}
