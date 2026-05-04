import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/a11y',
  timeout: 30_000,
  use: { ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @myclash/web-public dev',
      url: 'http://localhost:3001',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @myclash/web-scoring dev',
      url: 'http://localhost:3002',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @myclash/web-admin dev',
      url: 'http://localhost:3003',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
