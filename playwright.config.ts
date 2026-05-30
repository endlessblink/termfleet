import { defineConfig } from "@playwright/test";

// Browser-based flow tests run against the Vite "review" server on :5177.
// In the browser there is no Tauri runtime, so the native VTE pane never
// attaches and terminals always use the web xterm renderer — the same path
// canvas/map terminal nodes use in the desktop app.
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 60_000,
  webServer: {
    command: "npm run review",
    url: "http://127.0.0.1:5177/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
