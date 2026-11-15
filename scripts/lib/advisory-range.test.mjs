import assert from 'node:assert/strict';
import test from 'node:test';

import { inRange, semverRange } from './advisory-range.mjs';

test('a range is read as GitHub writes it, and an unreadable one says so', () => {
  assert.equal(semverRange('>= 12.0.0, < 12.5.0'), '>= 12.0.0 < 12.5.0');
  assert.equal(semverRange('=< 3.1.4'), '<= 3.1.4');
  assert.equal(inRange('12.3.2', '>= 12.0.0, < 12.5.0'), true);
  assert.equal(inRange('12.5.0', '>= 12.0.0, < 12.5.0'), false);
  assert.equal(inRange('12.3.2', 'before the fix'), null);
  assert.equal(inRange('12.3.2', ''), null);
});

// React's advisories list the versions hit instead of a range, in three spellings; read as one
// AND range, a list matched no version and the check passed in silence. Each listed version reads
// up to the version that fixed it (React's real GHSA-fv66 data).
test('a list of versions is read against the versions that fixed them', () => {
  const react = ['19.0.0, 19.1.0, 19.1.1, 19.2.0', '19.0.1, 19.1.2, 19.2.1'];
  assert.equal(inRange('19.2.0', ...react), true);
  assert.equal(inRange('19.1.1', ...react), true);
  assert.equal(inRange('19.1.2', ...react), false);
  assert.equal(inRange('19.2.1', ...react), false);
  assert.equal(inRange('2.2.3', '2.2.2,2.2.3,2.2.4', '2.2.5'), true);
  assert.equal(inRange('19.1.5', '19.1.4, 19.1.5 19.2.0', '19.1.6, 19.2.1'), true);
  assert.equal(inRange('19.1.6', '19.1.5 , 19.1.6', '19.1.7'), true);
});

// A bare version is not "only this one": astro's `6.3.1` (patched `>= 6.3.3`) is `< 6.3.3` in
// GitHub's reviewed copy, mermaid's `8.13.6` (no patched version given) is `< 8.13.8`.
test('one bare version reads as below its fix, and without a fix it is unreadable', () => {
  assert.equal(inRange('6.3.0', '6.3.1', '>= 6.3.3'), true);
  assert.equal(inRange('6.3.2', '6.3.1', '>= 6.3.3'), true);
  assert.equal(inRange('6.3.3', '6.3.1', '>= 6.3.3'), false);
  assert.equal(inRange('8.13.7', '8.13.6', ''), null);
  assert.equal(inRange('19.2.0', '19.0.0, 19.2.0', undefined), null);
});

// A comma that meant OR, read as an AND, narrows the range and passes what it dropped.
test('a range no version satisfies, or with two upper or two lower bounds, is unreadable', () => {
  assert.equal(inRange('12.0.1', '>= 12.0.0, < 12.0.2, < 11.2.4'), null);
  assert.equal(inRange('8.0.0', '<7.119.1, <8.33.0'), null);
  assert.equal(inRange('14.0.0', '>= 13.3, >= 14, >=15, >=16'), null);
  assert.equal(inRange('12.3.2', '>= 12.1.0, < 12.5.0'), true);
});
