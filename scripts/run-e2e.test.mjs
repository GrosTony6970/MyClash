import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { playwrightVerdict } from './run-e2e.mjs';

/**
 * The runner reads Playwright's output as it streams and decides two things
 * from it: when it may kill a run that has reported, and what a run that never
 * reported is worth. Both used to read the bare words `passed` and `failed`
 * anywhere in the stream, which is not the same question — see the docstrings
 * in run-e2e.mjs.
 *
 * The shapes below are `generateSummaryMessage`'s, playwright 1.62.1
 * `lib/runner/index.js:1183`.
 */

test('nothing is decided before the epilogue', () => {
  assert.equal(playwrightVerdict(''), 'pending');
  assert.equal(playwrightVerdict('Running 23 tests using 1 worker\n'), 'pending');
});

test('a test title carrying the word does not end the run', () => {
  // This is the defect. `output.includes('passed')` matched here, armed the
  // kill timer mid-run, and two seconds later the suite exited green.
  const output = [
    '  ok  1 [chromium] › tests/a11y/event.spec.ts:4:5 › 3 passed exchanges are counted\n',
    '     2 tests/a11y/event.spec.ts:9:5 › 1 failed exchange is refused\n',
  ].join('');

  assert.equal(playwrightVerdict(output), 'pending');
});

test('the epilogue of a clean run says passed', () => {
  assert.equal(playwrightVerdict('\n  23 passed (49.4s)\n'), 'passed');
});

test('a failure wins whichever way round the lines are read', () => {
  assert.equal(playwrightVerdict('\n  2 failed\n  21 passed (54.2s)\n'), 'failed');
  assert.equal(playwrightVerdict('\n  21 passed (54.2s)\n  2 failed\n'), 'failed');
});

test('a failing run with nothing passing still says failed', () => {
  assert.equal(playwrightVerdict('\n  2 failed\n'), 'failed');
});

test('an interrupted run is not a passing run', () => {
  // Ctrl+C prints these beside a passed count, and that run did not finish.
  assert.equal(playwrightVerdict('\n  1 interrupted\n  14 passed (12.0s)\n'), 'failed');
  assert.equal(playwrightVerdict('\n  8 did not run\n  14 passed (12.0s)\n'), 'failed');
});

test('a flaky run is a passing run', () => {
  // Playwright exits 0 on a retry that succeeded. `retries` is 0 in
  // playwright.config.ts today, so this guards the config, not the present.
  assert.equal(playwrightVerdict('\n  1 flaky\n  22 passed (51.0s)\n'), 'passed');
});

test('colour in the stream does not hide the epilogue', () => {
  // FORCE_COLOR puts an escape between the line start and the count.
  assert.equal(playwrightVerdict('\n\x1b[31m  2 failed\x1b[39m\n'), 'failed');
});

test('importing the runner boots no dev server', () => {
  // The entry guard is what makes every test above possible, and it has to be
  // tested from a SEPARATE process: this file already imported the module at
  // the top, so an `await import()` here is a cache hit that runs nothing and
  // would pass with the guard deleted. Without the guard the child boots three
  // Next servers and never exits.

  // A file:// URL, not a path: on Windows `import('F:/…')` is an unsupported
  // URL scheme, so a path here would fail for a reason that is not the guard.
  const runner = new URL('./run-e2e.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(runner)});`],
    { timeout: 20_000, stdio: 'ignore' },
  );

  assert.equal(child.signal, null, 'importing the runner did not return within 20s');
  assert.equal(child.status, 0);
});
