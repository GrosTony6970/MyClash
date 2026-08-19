import assert from 'node:assert/strict';
import test from 'node:test';

import {
  forbiddenEnvKeys,
  mostSpecificMatches,
  scanFrontendRoots,
} from './check-client-secret-boundaries.mjs';

// The fixtures below are hand-written and use invented keys. None is derived
// from forbiddenEnvKeys: a fixture built from the thing under test cannot
// falsify it. The real list is exercised separately, as a property.

const KEYS = ['ALPHA_SECRET', 'SECRET', 'secret', 'UNRELATED_KEY'];

test('a subsumed key is not reported beside the longer key that matched', () => {
  // The defect this rule closes. 'SECRET' is inside 'ALPHA_SECRET', so the
  // naive "report every match" spelling names one leak twice under two labels
  // and reads as two problems.
  assert.deepEqual(mostSpecificMatches('const x = ALPHA_SECRET;', KEYS), ['ALPHA_SECRET']);

  // Falsifies the fix: the spelling this replaced still double-reports.
  const everyMatch = KEYS.filter((key) => 'const x = ALPHA_SECRET;'.includes(key));
  assert.deepEqual(everyMatch, ['ALPHA_SECRET', 'SECRET']);
});

test('a bare shorter key still reports when nothing longer matched', () => {
  // Subsumption is decided per FILE, not by the shape of the list. A component
  // naming the bare form is a finding even though a longer key exists that
  // would have hidden it — this is the case the whole rule risks swallowing.
  assert.deepEqual(mostSpecificMatches('const x = SECRET;', KEYS), ['SECRET']);
});

test('keys that differ only in case do not subsume each other', () => {
  // 'secret' is not a substring of 'SECRET'. Two distinct occurrences are two
  // findings, and an operator needs to see both spellings.
  assert.deepEqual(mostSpecificMatches('SECRET and secret', KEYS), ['SECRET', 'secret']);

  // And the upper-case form is still subsumed by a longer upper-case key when
  // one is present, while its lower-case twin survives beside it.
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET and secret', KEYS), [
    'ALPHA_SECRET',
    'secret',
  ]);
});

test('unrelated keys are reported alongside a subsumed pair', () => {
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET, UNRELATED_KEY', KEYS), [
    'ALPHA_SECRET',
    'UNRELATED_KEY',
  ]);
});

test('clean source reports nothing', () => {
  assert.deepEqual(mostSpecificMatches('export const apiUrl = "/api/v1";', KEYS), []);
});

test('the answer does not depend on the order of the key list', () => {
  // The filter reads `matched`, never the list's position. If that ever changes
  // to an index-based comparison, this is what catches it.
  const reversed = [...KEYS].reverse();
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET and secret', reversed).sort(), [
    'ALPHA_SECRET',
    'secret',
  ]);
});

// ── The real list ────────────────────────────────────────────────────────────

test('every forbidden key can still report itself', () => {
  // No key may be permanently shadowed. A key that can never be the answer is
  // dead weight pretending to be coverage — which is precisely the failure this
  // whole slice was about.
  for (const key of forbiddenEnvKeys) {
    assert.ok(
      mostSpecificMatches(`const leak = process.env.${key};`).includes(key),
      `${key} matched nothing but itself and was still dropped`,
    );
  }
});

test('the forbidden list has no duplicate entries', () => {
  // Two identical entries both survive the filter (`other !== key` compares
  // values), so a duplicate would report the same leak twice — the exact
  // outcome the rule exists to prevent.
  assert.deepEqual([...new Set(forbiddenEnvKeys)], forbiddenEnvKeys);
});

test('the keys taken over from infra:review are still in the list', () => {
  // check-infra-review.mjs deleted its per-file copies on the strength of these
  // living here. If one is dropped, the fact stops being guarded anywhere —
  // there is no longer a second gate to fall back on.
  for (const key of ['SERVICE_ROLE', 'service_role', 'SEED_ADMIN', 'SEED_ADMIN_PASSWORD']) {
    assert.ok(forbiddenEnvKeys.includes(key), `${key} was removed with no owner to replace it`);
  }
});

test('the scan reports how many files it read, not how many leaked', () => {
  // The count is what the harness checks for an empty scan, so it has to be the
  // number of files READ. Before it existed this gate printed the same clean
  // line whether it had walked three app trees or nothing at all.
  const { leaks, scanned } = scanFrontendRoots();

  assert.ok(Array.isArray(leaks));
  assert.ok(
    scanned > 100,
    `the three web app trees hold thousands of scannable files; got ${scanned}`,
  );
});
