import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: process.env.CI === 'true',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1_440, height: 900 },
    trace: 'retain-on-failure',
  },
});
