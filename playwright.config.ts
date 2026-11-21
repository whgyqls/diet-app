import { defineConfig, devices } from '@playwright/test';

const PORT = 3006;

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
