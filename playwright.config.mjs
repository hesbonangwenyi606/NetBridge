import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  timeout: 180000,
  expect: { timeout: 25000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    viewport: { width: 1440, height: 1050 },
    launchOptions: process.platform === 'win32' ? { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
