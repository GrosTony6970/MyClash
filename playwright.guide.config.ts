import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Takes the organiser guide's screenshots (apps/web-marketing/src/assets/guide/).
// Run by hand, never in CI: `E2E_CLEANUP=1 pnpm guide:screenshots`.
//
// It targets the same deployed stack as `playwright.e2e.config.ts` and reuses
// its login (global-setup). It WRITES data: the spec builds a hidden `test`
// Event and hard-deletes it at the end, and E2E_CLEANUP=1 makes global-teardown
// delete the throwaway Event global-setup creates.
loadEnv({ path: '.env.e2e' });

const baseURL = process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';

export default defineConfig({
  testDir: './tests/guide',
  workers: 1,
  // A retry would build a second Event; one clean failure is easier to read.
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    // Same reason as the E2E config: prod api.myclash.fr serves a dev cert.
    ignoreHTTPSErrors: true,
    storageState: 'tests/e2e/.auth/admin.json',
    // The guide's screenshots are English (operator ruling); the spec also sets
    // the app's own locale cookie, which outranks this header.
    locale: 'en-GB',
    viewport: { width: 1280, height: 800 },
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
});
