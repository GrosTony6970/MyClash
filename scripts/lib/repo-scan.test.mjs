import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { REPO_IGNORED_DIRS } from './repo-scan.mjs';

const root = process.cwd();

test('carries the entries the two hand-maintained copies had each lost', () => {
  // The drift this module exists to end: `_bmad` was excluded by
  // check-complexity.mjs only, `.remember` by check-todos.mjs only.
  assert.ok(REPO_IGNORED_DIRS.has('_bmad'));
  assert.ok(REPO_IGNORED_DIRS.has('.remember'));
});

test('excludes build output, tool caches and test artefacts', () => {
  for (const name of [
    '.agents',
    '.claude',
    '.codex',
    '.git',
    '.kiro',
    '.next',
    '.pnpm-store',
    '.turbo',
    '.understand-anything',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
  ]) {
    assert.ok(REPO_IGNORED_DIRS.has(name), `${name} must be ignored`);
  }
});

test('does not exclude a directory holding product source', () => {
  // A blanket entry like `src` or `apps` here would silently empty every scan
  // that uses it, and every gate would go green for the wrong reason.
  for (const name of ['apps', 'packages', 'scripts', 'src', 'infra']) {
    assert.equal(REPO_IGNORED_DIRS.has(name), false, `${name} must be scanned`);
  }
});

test('the gates that walk the repo root hold no private ignore list', () => {
  // Falsifies the extraction itself. If a copy is ever reintroduced alongside
  // the import, the two drift again and this module stops being the one place
  // an exclusion has to be added.
  for (const gate of ['check-complexity.mjs', 'check-todos.mjs']) {
    const source = readFileSync(join(root, 'scripts', gate), 'utf8');
    assert.match(source, /REPO_IGNORED_DIRS/, `${gate} must use the shared set`);
    assert.doesNotMatch(
      source,
      /const\s+ignoredDirs\s*=\s*new Set\(\[/,
      `${gate} must not declare its own ignore set`,
    );
  }
});
