import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 90000,
  workers: 1,
  expect: { timeout: 30000 },
  use: { baseURL: 'http://localhost:8088', browserName: 'chromium', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { command: 'npx expo start --web --port 8088', url: 'http://localhost:8088', reuseExistingServer: true, timeout: 180000 },
});
