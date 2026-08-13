#!/usr/bin/env node
/**
 * Build the apps whose page loads scripts/check-bundle-budgets.mjs weighs.
 *
 * ── Why a driver and not three CI steps ─────────────────────────────────────
 * The build list IS the budget registry. Iterating `budgets` means a new
 * page-load entry is built the moment it is added, and an entry that is added
 * without a build cannot sit dormant reporting nothing — which is the failure
 * this whole area keeps repeating. A hand-listed set of app names here would be
 * a fourth place that has to agree with the registry.
 *
 * ── Why the placeholder env is derived, not listed ──────────────────────────
 * Each app's next.config.ts throws under NODE_ENV=production when a name in its
 * REQUIRED_PROD_ENV is unset, and the lists differ per app. The script this
 * replaces (apps/web-public/scripts/perf-build.mjs) kept a hand-copied list of
 * five names, and it rotted: NEXT_PUBLIC_MARKETING_URL was added to the guard
 * and forgotten in the copy, so the gate failed on every machine without a
 * .env, blaming missing build-time env for what was a stale mirror.
 *
 * So the names are read out of next.config.ts with `parseRequiredEnv` — already
 * exported and tested by check-client-env-contract.mjs, whose own CLI is import
 * guarded. Adding a name to a guard needs no edit here. The class of bug is
 * removed rather than detected.
 *
 * One uniform value serves every name. That is not a guess: ci.yml's
 * trivy-images job already builds all three web images passing
 * https://ci.invalid for every derived NEXT_PUBLIC_*, including the Supabase
 * anon key, and those legs pass. A real value in the environment always wins,
 * so CI's own configuration is never overridden.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { budgets } from './check-bundle-budgets.mjs';
import { parseRequiredEnv } from './check-client-env-contract.mjs';

const root = process.cwd();

/**
 * Stand-in for a build-time public env var.
 *
 * Every REQUIRED_PROD_ENV name across the three apps is a URL or the Supabase
 * anon key, and next.config only asserts presence. A URL-shaped value satisfies
 * both, and matches what CI already passes to the image builds.
 */
export const PLACEHOLDER_VALUE = 'https://ci.invalid';

/** The apps a page-load budget weighs, in registry order. */
export function budgetedApps(registry = budgets) {
  return registry.filter((budget) => budget.type === 'page-load').map((budget) => budget.app);
}

/**
 * Placeholder env for one app: every name its next.config.ts requires that the
 * real environment does not already set.
 */
export function placeholderEnv(configSource, environment = {}) {
  const required = parseRequiredEnv(configSource);
  if (required === null) return null;
  return Object.fromEntries(
    required.filter((name) => !environment[name]).map((name) => [name, PLACEHOLDER_VALUE]),
  );
}

function buildApp(app) {
  const configPath = join(root, 'apps', app, 'next.config.ts');
  if (!existsSync(configPath)) {
    return `apps/${app}/next.config.ts does not exist — the budget names an app that cannot be built.`;
  }

  const placeholders = placeholderEnv(readFileSync(configPath, 'utf8'), process.env);
  if (placeholders === null) {
    return `apps/${app}/next.config.ts declares no REQUIRED_PROD_ENV block. The build guard has moved, and this driver would supply nothing.`;
  }

  // A stale .next outlives a dependency change: old manifests point at chunks
  // the current tree no longer emits, and the budget would weigh a build nobody
  // has. Inherited from perf-build.mjs, whose reasoning still holds.
  rmSync(join(root, 'apps', app, '.next'), { recursive: true, force: true });

  // Windows cannot spawn pnpm.cmd without a shell, and passing an args array
  // alongside shell:true is what raises DEP0190 — the args are concatenated
  // unescaped rather than passed through. One command string sidesteps it. The
  // app name is a registry constant, never input.
  const onWindows = process.platform === 'win32';
  const command = onWindows ? `pnpm.cmd --filter @myclash/${app} build` : 'pnpm';
  const args = onWindows ? [] : ['--filter', `@myclash/${app}`, 'build'];
  const result = spawnSync(command, args, {
    cwd: root,
    // Real values win. Placeholders only fill what is absent, so CI's own
    // configuration is never overridden by this script.
    env: { ...placeholders, ...process.env },
    shell: onWindows,
    stdio: 'inherit',
  });

  if (result.error) return `apps/${app}: ${result.error.message}`;
  return result.status === 0 ? null : `apps/${app}: next build exited ${result.status}`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded so the test file can import the helpers without building anything.
const invokedDirectly = process.argv[1]?.endsWith('build-app-bundles.mjs');
if (invokedDirectly) {
  const apps = budgetedApps();
  if (apps.length === 0) {
    console.error('No page-load budgets are registered, so there is nothing to build.');
    process.exitCode = 1;
  } else {
    console.log(`Building ${apps.length} app(s) for the bundle budgets: ${apps.join(', ')}.`);
    const failures = apps.map(buildApp).filter(Boolean);
    if (failures.length > 0) {
      console.error(
        ['Bundle budget build failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
      );
      process.exitCode = 1;
    } else {
      console.log('Built every app the bundle budgets weigh.');
    }
  }
}
