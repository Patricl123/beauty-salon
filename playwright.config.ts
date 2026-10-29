import { defineConfig, devices } from "@playwright/test";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: false,
  outputDir: "./test-results/demo",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: `${npm} run dev -- --mode e2e-demo --port 5174 --strictPort`,
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      VITE_DATA_SOURCE: "demo",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
    },
  },
});
