import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:3020', trace: 'retain-on-failure' },
  projects: [
    { name: 'Android Chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iPhone WebKit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'tsx tests/e2e-server.ts', url: 'http://127.0.0.1:3020/', timeout: 60_000 },
});
