import assert from 'node:assert/strict';
import test from 'node:test';

import { findAnyLeaks, scanForAnyLeaks } from './check-shared-type-leaks.mjs';

test('the shapes the gate catches', () => {
  for (const line of [
    'const y = z as any;',
    'let a: any[] = [];',
    'const b = <any>c;',
    'function f(): any {',
  ]) {
    assert.deepEqual(findAnyLeaks(line, 'x.ts'), [`x.ts:1: ${line}`], line);
  }
});

test('a word that merely contains "any" is not a leak', () => {
  for (const line of ['const many = 1;', 'anything();', 'const co: Company = x;']) {
    assert.deepEqual(findAnyLeaks(line, 'x.ts'), [], line);
  }
});

test('KNOWN GAP: an annotation whose colon follows a word is not caught', () => {
  // The rule is /(^|[^\w])((as|:)\s+any\b|…)/ — the colon has to sit at the start
  // of the line or after a NON-word character. That holds for a return type
  // (`): any`) and never for a variable, parameter or property, because those
  // put an identifier immediately before the colon.
  //
  // Recorded rather than fixed: widening the rule changes what the gate FINDS,
  // which is a decision about the codebase and not about the gate's shape. This
  // test exists so the hole is visible instead of implied by silence — probe
  // with `as any` when checking whether this gate is load-bearing.
  for (const missed of ['let x: any;', 'type T = { f: any };', 'function g(p: any) {}']) {
    assert.deepEqual(findAnyLeaks(missed, 'x.ts'), [], missed);
  }
});

test('every leak in a file is reported with its line', () => {
  const source = ['const a = b as any;', 'const ok = 1;', 'let c: any[] = [];'].join('\n');

  assert.deepEqual(findAnyLeaks(source, 'p/x.ts'), [
    'p/x.ts:1: const a = b as any;',
    'p/x.ts:3: let c: any[] = [];',
  ]);
});

test('the scan skips test files, and counts only what could have leaked', () => {
  // The count is what the harness checks for an empty scan. Counting the walk's
  // output instead would report a healthy number even if every file were skipped.
  const paths = ['a.test.ts', 'b.spec.ts', 'c.ts', 'd.ts'];
  const read = (path) => (path === 'c.ts' ? 'const v = x as any;' : 'const v = 1;');

  const { findings, scanned } = scanForAnyLeaks(paths, read, (path) => path);

  assert.deepEqual(findings, ['c.ts:1: const v = x as any;']);
  assert.equal(scanned, 2, 'the .test.ts and .spec.ts files are skipped before they are read');
});

test('the named tournament-query exemptions are skipped', () => {
  const paths = ['tournament-query.types.ts', 'tournament-query.tools.service.ts'];
  const read = () => 'const v = x as any;';

  const { findings, scanned } = scanForAnyLeaks(paths, read, (path) => path);

  assert.deepEqual(findings, []);
  assert.equal(scanned, 0);
});
