import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Prod E2E specs live in tests/e2e and run via playwright.e2e.config.ts
  // (they hit a deployed env + write data). Keep them out of the local harness.
  testIgnore: ['**/e2e/**'],
  timeout: 30_000,
  workers: 1,
  // html FIRST. Playwright ends reporters one at a time, in this order, and scripts/run-e2e.mjs
  // kills it two seconds after `list` prints the epilogue. Listed second, the report could still
  // be writing when that kill lands. CI uploads playwright-report/.
  reporter: [['html', { open: 'never' }], ['list']],
  use: { ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
