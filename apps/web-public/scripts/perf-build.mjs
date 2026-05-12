/**
 * perf-build.mjs
 *
 * Ensures a non-standalone Next.js build exists in .next/ before the
 * performance budget scripts run.
 *
 * The budget must measure the current working tree. Remove any stale
 * `.next` output first because dependency upgrades can leave old manifests
 * pointing at obsolete assets.
 */

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));

rmSync(new URL('../.next/', import.meta.url), {
  recursive: true,
  force: true,
});

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['run', 'build'], {
  cwd: appDir,
  env: {
    ...process.env,
    MYCLASH_NEXT_OUTPUT: 'default',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
