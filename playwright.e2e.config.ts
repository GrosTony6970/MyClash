import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Prod-targeted E2E config. Separate from the local harness in
// `playwright.config.ts` (which boots the apps via scripts/run-e2e.mjs and
// runs the a11y + perf suites against localhost). These tests run against a
// deployed environment and WRITE data, so they live in their own config with
// a login + throwaway-test-event lifecycle (see global-setup/global-teardown).
//
// Secrets come from `.env.e2e` (git-ignored) locally, or from CI secrets.
loadEnv({ path: '.env.e2e' });

const baseURL = process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';

export default defineConfig({
  testDir: './tests/e2e',
  // One worker: every spec shares the single throwaway event created in
  // global-setup, so writes must not race.
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL,
    // Prod api.myclash.fr currently serves an untrusted dev cert; prefer
    // same-origin admin.myclash.fr/api/* calls (see project memory).
    ignoreHTTPSErrors: true,
    // Reuse the session captured once in global-setup (login is rate-limited).
    storageState: 'tests/e2e/.auth/admin.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
