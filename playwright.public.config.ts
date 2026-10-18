import { defineConfig } from '@playwright/test';
export default defineConfig({
  globalTeardown: './tests/public-browser/teardown.ts',
  testDir: './tests/public-browser',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4322',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/public-browser/server.ts',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: 'list',
  timeout: 60000,
});
