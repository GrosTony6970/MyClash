import assert from 'node:assert/strict';
import test from 'node:test';

import { findDebtMarkers, scanForDebtMarkers } from './check-todos.mjs';

test('an untracked marker is reported with its line and its text', () => {
  const source = ['const a = 1;', '// TODO: wire this up', 'const b = 2;'].join('\n');

  assert.deepEqual(findDebtMarkers(source, 'apps/api/src/x.ts'), [
    'apps/api/src/x.ts:2: // TODO: wire this up',
  ]);
});

test('a marker tied to a task reference is not debt', () => {
  for (const line of [
    '// TODO T-142: finish the wiring',
    '// FIXME O-7 needs the owner',
    '// TODO see OWNER_TASKS',
    '// TODO tracked in OWNER_TASKS',
    '// TODO https://github.com/owner/repo/issues/1',
  ]) {
    assert.deepEqual(findDebtMarkers(line, 'x.ts'), [], line);
  }
});

test('the match is case sensitive, so a placeholder word is not debt', () => {
  // ai-data-quality.service.ts lists 'todo' as a placeholder WORD it detects,
  // and tests/e2e uses test.fixme. Both are code rather than debt, and neither
  // can be fixed by adding a task marker.
  assert.deepEqual(findDebtMarkers("const placeholders = ['todo', 'tbd'];", 'x.ts'), []);
  assert.deepEqual(findDebtMarkers('test.fixme("later", () => {});', 'x.ts'), []);
});

test('a marker inside a longer word is not a marker', () => {
  assert.deepEqual(findDebtMarkers('const TODOS_URL = "/api/todos";', 'x.ts'), []);
});

test('a file on the allowlist is exempt whatever it holds', () => {
  assert.deepEqual(findDebtMarkers('// TODO: bare', 'scripts/check-todos.mjs'), []);
  assert.deepEqual(findDebtMarkers('// TODO: bare', 'docs/CODE_QUALITY_REVIEW.md'), []);
});

test('every marker in a file is reported, not just the first', () => {
  const source = ['// TODO: one', 'ok', '// FIXME: two'].join('\n');

  assert.deepEqual(findDebtMarkers(source, 'x.ts'), [
    'x.ts:1: // TODO: one',
    'x.ts:3: // FIXME: two',
  ]);
});

test('the scan skips ignored prefixes, and counts only the files it read', () => {
  // The count is what the harness checks for an empty scan, so it has to mean
  // "files the rule could have found something in" — not what the walk returned.
  const paths = ['docs/superpowers/plans/a.md', 'docs/b.md', 'docs/c.md'];
  const read = (path) => (path === 'docs/b.md' ? '// TODO: bare' : 'clean');

  const { findings, scanned } = scanForDebtMarkers(paths, read, (path) => path);

  assert.deepEqual(findings, ['docs/b.md:1: // TODO: bare']);
  assert.equal(scanned, 2, 'the docs/superpowers/ path is skipped before it is read');
});
