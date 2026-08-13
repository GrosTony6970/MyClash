import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  budgets,
  checkPageLoadBudget,
  checkStaticBudget,
  layoutEntryJsFiles,
  rootMainJsFiles,
} from './check-bundle-budgets.mjs';

const root = process.cwd();

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'myclash-bundle-'));
}

// ── The Next 16 manifest rename ──────────────────────────────────────────────

test('reads the shared chunks out of rootMainFiles', () => {
  const manifest = {
    rootMainFiles: ['static/chunks/main.js', 'static/chunks/framework.js', 'static/css/app.css'],
  };
  assert.deepEqual(rootMainJsFiles(manifest), [
    'static/chunks/main.js',
    'static/chunks/framework.js',
  ]);
});

test('de-duplicates chunks named more than once', () => {
  const manifest = { rootMainFiles: ['a.js', 'a.js', 'b.js'] };
  assert.deepEqual(rootMainJsFiles(manifest), ['a.js', 'b.js']);
});

test('an app-build-manifest-shaped payload yields nothing', () => {
  // The shape this gate used to read. Next 16 removed the file that carried it,
  // so a manifest without rootMainFiles must resolve to zero assets and fail
  // loudly rather than score zero bytes and pass.
  const legacy = { pages: { '/layout': ['static/chunks/main.js'], '/page': [] } };
  assert.deepEqual(rootMainJsFiles(legacy), []);
});

// ── The root-layout entry, the half rootMainFiles cannot see ─────────────────

// Shape taken from a real apps/web-staff/.next/server/app/lices/page
// client-reference manifest.
const MANIFEST = (app) =>
  `self.__RSC_MANIFEST=...{"entryJSFiles":{"[project]/apps/${app}/app/layout":` +
  `["static/chunks/runtime.js","static/chunks/layout.js"],` +
  `"[project]/apps/${app}/app/lices/page":["static/chunks/runtime.js","static/chunks/page.js"]}};`;

function writePageLoadBuild(appRoot, app, { manifest = MANIFEST(app), chunks = {} } = {}) {
  const route = join(appRoot, '.next', 'server', 'app', 'lices');
  mkdirSync(route, { recursive: true });
  writeFileSync(join(route, 'page_client-reference-manifest.js'), manifest);
  mkdirSync(join(appRoot, '.next', 'static', 'chunks'), { recursive: true });
  writeFileSync(
    join(appRoot, '.next', 'build-manifest.json'),
    JSON.stringify({ rootMainFiles: ['static/chunks/shell.js'] }),
  );
  for (const [name, body] of Object.entries({ 'shell.js': 'shell', ...chunks })) {
    writeFileSync(join(appRoot, '.next', 'static', 'chunks', name), body);
  }
}

test('reads the root layout entry, not the route entry', () => {
  assert.deepEqual(layoutEntryJsFiles(MANIFEST('web-staff'), 'web-staff'), [
    'runtime.js',
    'layout.js',
  ]);
});

test('a manifest for another app yields nothing', () => {
  assert.deepEqual(layoutEntryJsFiles(MANIFEST('web-staff'), 'web-admin'), []);
});

test('an escaped manifest payload reads the same', () => {
  // Next emits this file's payload as a bare object in some builds and as an
  // escaped string literal in others. Only the quotes differ; the chunk paths
  // do not, and the reader must not care which it got.
  const escaped = MANIFEST('web-staff').replace(/"/g, '\\"');
  assert.deepEqual(layoutEntryJsFiles(escaped, 'web-staff'), ['runtime.js', 'layout.js']);
});

test('a layout entry that cannot be found fails instead of weighing the shell alone', () => {
  // The failure this budget exists to prevent: silently measuring half the
  // payload and passing, which is what the shell-only budget did for the
  // 188 KB icon barrel and the 181 KB dictionary.
  const appRoot = tempRoot();
  writePageLoadBuild(appRoot, 'web-staff', { manifest: 'self.__RSC_MANIFEST={};' });

  const result = checkPageLoadBudget(
    { name: 'app', type: 'page-load', root: appRoot, app: 'web-staff', budgetBytes: 1024 },
    { includeNext: true },
  );
  assert.equal(result.failures?.length, 1);
  assert.match(result.failures[0], /entryJSFiles/);
});

test('the page-load figure is the shell plus the layout entry', () => {
  const appRoot = tempRoot();
  writePageLoadBuild(appRoot, 'web-staff', {
    chunks: { 'runtime.js': 'a'.repeat(40_000), 'layout.js': 'b'.repeat(40_000) },
  });
  const budget = { name: 'app', type: 'page-load', root: appRoot, app: 'web-staff' };

  const passing = checkPageLoadBudget(
    { ...budget, budgetBytes: 100 * 1024 },
    { includeNext: true },
  );
  assert.equal(passing.failures, undefined);
  assert.match(passing.logs[0], /1 shell \+ 2 layout/);

  const failing = checkPageLoadBudget({ ...budget, budgetBytes: 10 }, { includeNext: true });
  assert.match(failing.failures[0], /above 10/);
});

test('page-load budgets stay off unless --include-next asked for them', () => {
  const result = checkPageLoadBudget({
    name: 'app',
    type: 'page-load',
    root: tempRoot(),
    app: 'web-staff',
    budgetBytes: 1024,
  });
  assert.equal(result.failures, undefined);
  assert.match(result.warnings[0], /--include-next/);
});

test('every page-load budget names the app whose layout it looks for', () => {
  for (const budget of budgets.filter((entry) => entry.type === 'page-load')) {
    assert.ok(budget.app, `${budget.name} needs an app`);
    assert.ok(
      budget.root.endsWith(budget.app),
      `${budget.name} looks for ${budget.app}'s layout but reads ${budget.root}`,
    );
  }
});

// ── The anti-vacuity assertion ───────────────────────────────────────────────

test('an empty scan root fails rather than reporting zero bytes', () => {
  // The defect that survived the public/ -> dist/ move: a walk that finds
  // nothing scores 0 bytes and passes, so the budget guards nothing.
  const appRoot = tempRoot();
  const result = checkStaticBudget({ name: 'site', root: appRoot, budgetBytes: 1024 });
  assert.equal(result.failures?.length, 1);
  assert.match(result.failures[0], /holds no files at all/);
});

test('a build that emits no JavaScript passes, and says so', () => {
  // Zero .js is the CORRECT result for the Astro marketing site, which inlines
  // its script. Only an empty root is a failure.
  const appRoot = tempRoot();
  writeFileSync(join(appRoot, 'index.html'), '<html><script>console.log(1)</script></html>');

  const result = checkStaticBudget({ name: 'site', root: appRoot, budgetBytes: 1024 });
  assert.equal(result.failures, undefined);
  assert.ok(result.logs.some((line) => /no emitted JavaScript/.test(line)));
});

test('emitted JavaScript over budget fails', () => {
  const appRoot = tempRoot();
  writeFileSync(join(appRoot, 'app.js'), 'x'.repeat(50_000));
  const result = checkStaticBudget({ name: 'site', root: appRoot, budgetBytes: 10 });
  assert.match(result.failures[0], /above 10/);
});

test('an absent root only fails under --require-build', () => {
  const budget = { name: 'site', root: join(tempRoot(), 'never-built'), budgetBytes: 1024 };
  assert.equal(checkStaticBudget(budget).failures, undefined);
  assert.match(checkStaticBudget(budget, { requireBuild: true }).failures[0], /does not exist/);
});

// ── Configuration ────────────────────────────────────────────────────────────

test('every configured budget names an app that exists', () => {
  assert.ok(budgets.length > 0);
  for (const budget of budgets) {
    assert.ok(budget.budgetBytes > 0, `${budget.name} needs a budget`);
    assert.match(budget.root, /^apps[\\/]/, `${budget.name} must point into apps/`);
  }
});

test('no budget weighs the shell alone', () => {
  // There were three shell budgets, one per app, and they measured the React
  // and Next runtime: no app-identifying symbol in any of their eighteen
  // chunks, four chunks byte-identical BETWEEN apps, and a 400 KB payload in a
  // root-layout provider moved the figure by zero. A page-load budget contains
  // every chunk they weighed, so a shell figure could only breach after the
  // page-load figure it is a subset of had already breached.
  //
  // Reintroducing one would re-add a framework-version detector wearing a
  // bundle budget's name, so the type is gone rather than merely unused.
  for (const budget of budgets) {
    assert.notEqual(budget.type, 'next', `${budget.name} weighs the shell alone`);
    assert.ok(
      ['static', 'page-load'].includes(budget.type),
      `${budget.name} has unknown type "${budget.type}" — the CLI would route it to the page-load check`,
    );
  }
});

test('every Next app has a page-load budget', () => {
  // Anti-vacuity for the registry itself: a fourth app, or an app whose entry
  // is dropped in a tidy-up, must not escape a budget silently.
  const nextApps = readdirSync(join(root, 'apps')).filter((app) =>
    existsSync(join(root, 'apps', app, 'next.config.ts')),
  );
  assert.ok(nextApps.length >= 3, `expected the real apps, found ${nextApps.join(', ')}`);
  for (const app of nextApps) {
    assert.ok(
      budgets.some((budget) => budget.type === 'page-load' && budget.app === app),
      `${app} has a next.config.ts but no page-load budget`,
    );
  }
});
