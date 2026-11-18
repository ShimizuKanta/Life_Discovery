import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    baseURL: 'http://127.0.0.1:4173/LifeDiscovery/',
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {},
    trace: 'retain-on-failure'
  },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/LifeDiscovery/', reuseExistingServer: !process.env.CI }
});
