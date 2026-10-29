import { defineConfig, devices } from "@playwright/test";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export default defineConfig({
  testDir: "./tests-cloud",
  outputDir: "./test-results/cloud",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5175",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "supabase-protocol",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "node test-support/mock-supabase.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: `${npm} run dev -- --mode e2e-cloud --port 5175 --strictPort`,
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        VITE_DATA_SOURCE: "supabase",
        VITE_SUPABASE_URL: "http://127.0.0.1:54329",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST_ONLY",
        VITE_TURNSTILE_SITE_KEY: "TEST_ONLY_SITE_KEY",
      },
    },
  ],
});
