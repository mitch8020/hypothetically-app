import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:7073',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        timezoneId: 'America/Los_Angeles',
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        timezoneId: 'Asia/Tokyo',
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --strictPort --port 7073',
    url: 'http://localhost:7073',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
