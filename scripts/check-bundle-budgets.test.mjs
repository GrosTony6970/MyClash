import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  budgets,
  checkNextBudget,
  checkStaticBudget,
  rootMainJsFiles,
} from './check-bundle-budgets.mjs';

const root = process.cwd();

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'myclash-bundle-'));
}

function writeNextBuild(appRoot, manifest, chunks = {}) {
  mkdirSync(join(appRoot, '.next', 'static', 'chunks'), { recursive: true });
  writeFileSync(join(appRoot, '.next', 'build-manifest.json'), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(chunks)) {
    writeFileSync(join(appRoot, '.next', name), body);
  }
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

test('a manifest with no usable chunks fails instead of scoring zero', () => {
  const appRoot = tempRoot();
  writeNextBuild(appRoot, { pages: { '/page': ['static/chunks/main.js'] } });

  const result = checkNextBudget(
    { name: 'app', type: 'next', root: appRoot, budgetBytes: 1024 },
    { includeNext: true, requireBuild: true },
  );
  assert.equal(result.failures?.length, 1);
  assert.match(result.failures[0], /rootMainFiles/);
});

test('a real manifest is weighed against the budget', () => {
  const appRoot = tempRoot();
  writeNextBuild(
    appRoot,
    { rootMainFiles: ['static/chunks/main.js'] },
    { 'static/chunks/main.js': 'x'.repeat(50_000) },
  );

  const passing = checkNextBudget(
    { name: 'app', type: 'next', root: appRoot, budgetBytes: 100 * 1024 },
    { includeNext: true },
  );
  assert.equal(passing.failures, undefined);

  const failing = checkNextBudget(
    { name: 'app', type: 'next', root: appRoot, budgetBytes: 10 },
    { includeNext: true },
  );
  assert.match(failing.failures[0], /above 10/);
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

test('the web-public budget agrees with the gate that owns it', () => {
  // web-public's own landing budget runs inside its test chain and is the
  // authority on this number. Two gates weighing the same shell must not drift
  // to different figures.
  const owner = readFileSync(
    join(root, 'apps', 'web-public', 'scripts', 'landing-bundle-budget.mjs'),
    'utf8',
  );
  const ownerBudget = /const budgetBytes = (\d+) \* 1024/.exec(owner);
  assert.ok(ownerBudget, 'could not read the web-public landing budget');

  const mirrored = budgets.find((budget) => budget.root.includes('web-public'));
  assert.equal(mirrored.budgetBytes, Number(ownerBudget[1]) * 1024);
});
