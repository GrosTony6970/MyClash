import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Prod E2E specs live in tests/e2e and run via playwright.e2e.config.ts
  // (they hit a deployed env + write data). Keep them out of the local harness.
  testIgnore: ['**/e2e/**'],
  timeout: 30_000,
  workers: 1,
  use: { ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
