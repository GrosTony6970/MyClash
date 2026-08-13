import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { PLACEHOLDER_VALUE, budgetedApps, placeholderEnv } from './build-app-bundles.mjs';
import { budgets } from './check-bundle-budgets.mjs';

const root = process.cwd();

const CONFIG = (names) =>
  `const REQUIRED_PROD_ENV = [\n${names.map((n) => `  '${n}',`).join('\n')}\n] as const;`;

// ── The build list is the budget registry ────────────────────────────────────

test('builds exactly the apps a page-load budget weighs', () => {
  assert.deepEqual(
    budgetedApps(),
    budgets.filter((budget) => budget.type === 'page-load').map((budget) => budget.app),
  );
});

test('a budget added to the registry is built without editing this script', () => {
  const registry = [
    { type: 'static', root: 'apps/web-marketing/dist', budgetBytes: 1 },
    { type: 'page-load', app: 'web-future', root: 'apps/web-future', budgetBytes: 1 },
  ];
  assert.deepEqual(budgetedApps(registry), ['web-future']);
});

// ── The env list is derived, not mirrored ────────────────────────────────────

test('derives every name the app config requires', () => {
  const env = placeholderEnv(CONFIG(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_STAFF_URL']), {});
  assert.deepEqual(env, {
    NEXT_PUBLIC_API_URL: PLACEHOLDER_VALUE,
    NEXT_PUBLIC_STAFF_URL: PLACEHOLDER_VALUE,
  });
});

test('a name added to a guard needs no edit here', () => {
  // The regression this replaces: perf-build.mjs kept five names by hand, and
  // NEXT_PUBLIC_MARKETING_URL was added to the guard and forgotten in the copy,
  // reddening the gate on every machine without a .env.
  const before = placeholderEnv(CONFIG(['NEXT_PUBLIC_API_URL']), {});
  const after = placeholderEnv(CONFIG(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_BRAND_NEW_URL']), {});
  assert.deepEqual(Object.keys(before), ['NEXT_PUBLIC_API_URL']);
  assert.deepEqual(Object.keys(after), ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_BRAND_NEW_URL']);
});

test('a real value is never overridden by a placeholder', () => {
  const env = placeholderEnv(CONFIG(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_STAFF_URL']), {
    NEXT_PUBLIC_API_URL: 'https://api.real.example',
  });
  assert.deepEqual(env, { NEXT_PUBLIC_STAFF_URL: PLACEHOLDER_VALUE });
});

test('a config with no guard block is a failure, not an empty env', () => {
  // Returning {} would build with nothing supplied and fail inside next build
  // with a message pointing at the Dockerfile — the misattribution that cost
  // seven commits last time. The driver must say the guard moved.
  assert.equal(placeholderEnv('export default {};', {}), null);
});

test('the placeholder is URL-shaped', () => {
  // Every REQUIRED_PROD_ENV name across the three apps is a URL or the Supabase
  // anon key; supabase-js rejects a non-http(s) URL at module scope during
  // prerender, so a bare token would break the build it is meant to enable.
  assert.match(PLACEHOLDER_VALUE, /^https:\/\//);
});

// ── Against the real apps ────────────────────────────────────────────────────

test('every budgeted app has a config this driver can read', () => {
  const apps = budgetedApps();
  assert.ok(apps.length >= 3, `expected the real apps, got ${apps.join(', ')}`);
  for (const app of apps) {
    const configPath = join(root, 'apps', app, 'next.config.ts');
    assert.ok(existsSync(configPath), `apps/${app}/next.config.ts must exist`);
    const env = placeholderEnv(readFileSync(configPath, 'utf8'), {});
    assert.notEqual(env, null, `apps/${app} has no REQUIRED_PROD_ENV block this driver can read`);
    assert.ok(Object.keys(env).length > 0, `apps/${app} derived no names`);
  }
});

test('the derived names match what the app actually requires', () => {
  // Anti-vacuity: the parse could silently return a subset and every other
  // assertion here would still pass. Compare against the literal names in the
  // config, found independently of parseRequiredEnv.
  for (const app of budgetedApps()) {
    const source = readFileSync(join(root, 'apps', app, 'next.config.ts'), 'utf8');
    const block = /REQUIRED_PROD_ENV\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
    const expected = [...new Set(block[1].match(/NEXT_PUBLIC_[A-Z0-9_]+/g))].sort();
    assert.deepEqual(Object.keys(placeholderEnv(source, {})).sort(), expected, `apps/${app}`);
  }
});
