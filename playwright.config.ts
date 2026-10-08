import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node tests/browser/server.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: 'list',
});
