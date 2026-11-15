import assert from 'node:assert/strict';
import test from 'node:test';

import { inRange, semverRange, versionsIn } from './advisory-range.mjs';

// `true` a hit, `false` safe, `null` in doubt: hits and doubts are both reported (ruling 806).

test('a range is read as GitHub writes it, and text no rule reads is in doubt', () => {
  assert.equal(semverRange('>= 12.0.0, < 12.5.0'), '>= 12.0.0 < 12.5.0');
  assert.equal(semverRange('=< 3.1.4'), '<= 3.1.4');
  assert.equal(inRange('12.3.2', '>= 12.0.0, < 12.5.0'), true);
  assert.equal(inRange('12.5.0', '>= 12.0.0, < 12.5.0', '12.5.0'), false);
  assert.equal(inRange('12.3.2', 'before the fix'), null);
  assert.equal(inRange('12.3.2', ''), null);
});

// React's advisories list the versions hit (GHSA-fv66, real data), in three spellings; read as
// one AND range, a list matched no version. A version neither listed nor before a fix is safe.
test('a list of versions is read as a list, its patches agreeing', () => {
  const react = ['19.0.0, 19.1.0, 19.1.1, 19.2.0', '19.0.1, 19.1.2, 19.2.1'];
  assert.equal(inRange('19.2.0', ...react), true);
  assert.equal(inRange('19.1.1', ...react), true);
  assert.equal(inRange('19.1.2', ...react), false);
  assert.equal(inRange('19.2.1', ...react), false);
  assert.equal(inRange('19.0.5', ...react), false);
  assert.equal(inRange('2.2.3', '2.2.2,2.2.3,2.2.4', '2.2.5'), true);
  assert.equal(inRange('19.1.5', '19.1.4, 19.1.5 19.2.0', '19.1.6, 19.2.1'), true);
  assert.equal(inRange('19.1.6', '19.1.5 , 19.1.6', '19.1.7'), true);
});

// A bare version is not "only this one": astro's `6.3.1` (patched `>= 6.3.3`) is `< 6.3.3` in
// GitHub's reviewed copy, mermaid's `8.13.6` (no patched version given) is `< 8.13.8`.
test('a version before a fix its patches name is in doubt, whatever the range says', () => {
  assert.equal(inRange('6.3.1', '6.3.1', '>= 6.3.3'), true);
  assert.equal(inRange('6.3.0', '6.3.1', '>= 6.3.3'), null);
  assert.equal(inRange('6.3.2', '6.3.1', '>= 6.3.3'), null);
  assert.equal(inRange('6.3.3', '6.3.1', '>= 6.3.3'), false);
  // astro's GHSA-xf8x: `<= 5.13.0`, patched `>= 5.13.2`; reviewed `< 5.13.2`. 5.13.1 exists.
  assert.equal(inRange('5.13.0', '<= 5.13.0', '>= 5.13.2'), true);
  assert.equal(inRange('5.13.1', '<= 5.13.0', '>= 5.13.2'), null);
  assert.equal(inRange('5.13.2', '<= 5.13.0', '>= 5.13.2'), false);
  // A fix on another minor line says nothing for this one: 1.3.0 was never fixed before 1.3.1.
  assert.equal(inRange('1.3.0', '>= 1.2.0, < 1.2.5', '1.2.5, 1.3.1'), null);
  // A fix on no line of this major says nothing either: our astro 7 against an astro 5 advisory.
  assert.equal(inRange('7.4.12', '<= 5.13.0', '>= 5.13.2'), false);
});

// The patched versions must say a version is fixed: none given, or fixes only on a later major,
// say nothing. astro's GHSA-8hv8 (bare `6.3.1`, patched `>= 6.3.3`) is `< 6.3.3` reviewed, astro
// 5 included; mermaid's GHSA-p3rp (`8.13.6`, `8.13.8`) is `< 8.13.8`, mermaid 7 included.
test('a version the patched versions do not call fixed is in doubt', () => {
  assert.equal(inRange('8.13.7', '8.13.6', ''), null);
  assert.equal(inRange('9.0.0', '<= 8.13.6', ''), null);
  assert.equal(inRange('19.1.0', '19.0.0, 19.2.0', undefined), null);
  assert.equal(inRange('19.2.0', '19.0.0, 19.2.0', undefined), true);
  assert.equal(inRange('5.18.0', '6.3.1', '>= 6.3.3'), null);
  assert.equal(inRange('0.0.2', '6.3.1', '>= 6.3.3'), null);
  assert.equal(inRange('7.0.0', '8.13.6', '8.13.8'), null);
  // Above every fix, or a fix on its own line: fixed.
  assert.equal(inRange('7.4.12', '6.3.1', '>= 6.3.3'), false);
  assert.equal(inRange('5.18.3', '6.3.1', '5.18.3, 6.3.3'), false);
});

test("a patched range's upper bound is not a fix", () => {
  assert.deepEqual(versionsIn('>= 6.3.3 < 7.0.0'), ['6.3.3']);
  assert.deepEqual(versionsIn('19.2.1, 19.0.1, >=19.1.2'), ['19.0.1', '19.1.2', '19.2.1']);
  assert.equal(inRange('6.3.2', '6.3.1', '>= 6.3.3 < 7.0.0'), null);
});

// A comma that meant OR, read as an AND, narrows the range and passes what it dropped; a lower
// bound written without its operator reads as one exact version.
test('a range its author cannot have meant is in doubt', () => {
  assert.equal(inRange('12.0.1', '>= 12.0.0, < 12.0.2, < 11.2.4'), null);
  assert.equal(inRange('8.0.0', '<7.119.1, <8.33.0'), null);
  assert.equal(inRange('14.0.0', '>= 13.3, >= 14, >=15, >=16'), null);
  // With a fix below it, 11.0.0 would read safe: only the misread range keeps it in doubt.
  assert.equal(inRange('11.0.0', '10.0.0 <= 12.0.10', '9.0.0'), null);
  assert.equal(inRange('12.3.2', '>= 12.1.0, < 12.5.0'), true);
});
