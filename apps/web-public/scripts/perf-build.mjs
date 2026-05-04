/**
 * perf-build.mjs
 *
 * Ensures a non-standalone Next.js build exists in .next/ before the
 * performance budget scripts run.
 *
 * If .next/app-build-manifest.json already exists (e.g. CI already ran
 * `next build` in a prior step) we skip the rebuild to avoid running
 * `next build` twice and to prevent the manifest from being written to
 * a different working directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = new URL('../.next/app-build-manifest.json', import.meta.url);

if (existsSync(manifestPath)) {
  console.log('perf-build: .next/app-build-manifest.json already exists, skipping rebuild.');
  process.exit(0);
}

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
