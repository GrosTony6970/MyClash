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

// The next.config production guard requires these NEXT_PUBLIC_* vars, but the
// perf build uses mocked data and never reaches real services — fill obvious
// placeholders when absent locally; CI's real values take precedence.
// Keep this list in step with REQUIRED_PROD_ENV in ../next.config.ts — a var
// added there and forgotten here fails this gate on every machine that has no
// .env, which is how NEXT_PUBLIC_MARKETING_URL went unnoticed.
const PERF_BUILD_ENV = {
  NEXT_PUBLIC_API_URL: 'http://localhost:4000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'perf-build-placeholder-anon-key',
  NEXT_PUBLIC_MARKETING_URL: 'http://localhost:3000',
  NEXT_PUBLIC_STAFF_URL: 'http://localhost:3002',
};
const placeholders = Object.fromEntries(
  Object.entries(PERF_BUILD_ENV).filter(([key]) => !process.env[key]),
);

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['run', 'build'], {
  cwd: appDir,
  env: {
    ...process.env,
    ...placeholders,
    MYCLASH_NEXT_OUTPUT: 'default',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
