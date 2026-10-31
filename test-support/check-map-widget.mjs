// Optional read-only smoke check of the public free map widget. No Supabase calls.
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({viewport:{width:800,height:450}});
  const response = await page.goto("https://yandex.ru/map-widget/v1/?ll=74.587887%2C42.875068&z=17&pt=74.587887%2C42.875068%2Cpm2rdm", {waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForTimeout(5000);
  await page.screenshot({path:"test-results/map-widget-live.png"});
  console.log(JSON.stringify({status:response?.status(),title:await page.title(),text:(await page.locator("body").innerText()).slice(0,250)}));
} finally { await browser.close(); }
