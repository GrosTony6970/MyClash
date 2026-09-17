import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Prod E2E specs live in tests/e2e and run via playwright.e2e.config.ts
  // (they hit a deployed env + write data). Keep them out of the local harness.
  testIgnore: ['**/e2e/**'],
  timeout: 30_000,
  workers: 1,
  // Order is the contract. Playwright ends reporters one at a time, in this order, and
  // scripts/run-e2e.mjs kills it two seconds after `list` prints the epilogue — so anything
  // listed after `list` is racing that kill.
  //
  //  - `html` FIRST: CI uploads playwright-report/, and listed later the report could still be
  //    writing when the kill lands.
  //  - `github` writes one `::error` annotation per failing test. Check-run annotations are
  //    PUBLIC on this repo while job logs and artifacts need admin rights, so this is the only
  //    channel that says WHICH test failed without a token. It runs unconditionally rather than
  //    behind `process.env.CI`: a harness that behaves differently in CI is the class of bug this
  //    whole file is recovering from. It prints no stdio of its own (`printsToStdio()` is false),
  //    its annotations are single-line, and it strips colour — so it cannot disturb `list` or the
  //    epilogue the runner reads.
  //  - `list` LAST: its epilogue is what arms the runner's two-second exit.
  reporter: [['html', { open: 'never' }], ['github'], ['list']],
  // Service workers are blocked because every spec here answers the API with `page.route`, and a
  // service worker's own requests never pass through it. web-staff registers its offline worker
  // on load (`apps/web-staff/public/sw.js`): it precaches four pages and answers `/api/` itself, so
  // those calls reached the dev server, came back 404, and failed `expectNoPageIssues` in the
  // scoring spec whenever the worker took control before the test's last check — CI run
  // 35226838601, after five green runs. Offline behaviour is tested by the prod suite in
  // `tests/e2e` (`playwright.e2e.config.ts`), which this does not touch.
  use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
