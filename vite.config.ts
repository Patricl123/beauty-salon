import { defineConfig, loadEnv } from "vite";
import { readBackendConfig } from "./src/lib/backendConfig";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  readBackendConfig({
    ...loadEnv(mode, process.cwd(), "VITE_"),
    ...process.env,
  });
  return {
    cacheDir: `node_modules/.vite/${mode}`,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: { manualChunks: { supabase: ["@supabase/supabase-js"] } },
      },
    },
  };
});
