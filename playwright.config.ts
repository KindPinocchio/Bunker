import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (!process.env.CI && existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: "tests/browser", fullyParallel: false, workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4173", viewport: { width: 1280, height: 900 }, trace: "retain-on-failure", launchOptions: { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run preview -- --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI },
});
