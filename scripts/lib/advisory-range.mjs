import semver from 'semver';

/**
 * Whether a locked version is hit by a GitHub repository advisory (scripts/check-repo-advisories.mjs).
 *
 * Repository advisories are written by hand, before GitHub reviews them, and the hand is often
 * loose: mermaid's bare `8.13.6` and astro's `<= 5.13.0` (patched `>= 5.13.2`) both mean "before
 * the fix" in GitHub's reviewed copies; a comma can mean OR (`<7.119.1, <8.33.0`). Three review
 * rounds each found a new shape that a literal reading passed in silence. So the rule is doubt
 * means report (operator ruling 806, 2026-11-15): a version reads safe only when the written range
 * AND the advisory's own patched versions both say so. Anything else is a hit (`true`) or in doubt
 * (`null`), and both are reported; an advisory in doubt stops being reported once GitHub's global
 * database lists it (then `pnpm audit` owns it), or through the ignore list.
 */

/** Versions named in a text (`>= 6.3.3`, `19.0.1, 19.1.2`), oldest first. */
export function versionsIn(text) {
  const found = String(text ?? '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu) ?? [];
  return found.filter((version) => semver.valid(version)).sort(semver.compare);
}

/**
 * A comparator set that cannot be the range its author meant: two upper or two lower bounds (a
 * comma that meant OR), or an exact version beside another bound (`10.0.0 <= 12.0.10`, a lower
 * bound written without its operator).
 */
function misread(written) {
  return new semver.Range(written).set.some((comparators) => {
    const operators = comparators.map((comparator) => comparator.operator);
    const upper = operators.filter((operator) => operator.startsWith('<')).length;
    const lower = operators.filter((operator) => operator.startsWith('>')).length;
    const exact = operators.filter((operator) => operator === '' || operator === '=').length;
    return upper > 1 || lower > 1 || (exact > 0 && operators.length > 1);
  });
}

/**
 * The written range as node-semver reads it, or null when it cannot be read as written: bare
 * versions are a list (`19.0.0, 19.1.0`, React's), a range's comma is an AND (`>= 12.0.0, <
 * 12.5.0`). Null too: a range no version satisfies, and one `misread` names.
 */
export function semverRange(range) {
  const text = String(range ?? '').trim();
  const tokens = text.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => semver.valid(token))) return tokens.join(' || ');
  const written = text.replace(/,\s*/gu, ' ').replace(/=</gu, '<=').replace(/=>/gu, '>=');
  if (!written || !semver.validRange(written) || !semver.minVersion(written)) return null;
  return misread(written) ? null : written;
}

/**
 * What the patched versions say about a version outside the written range: `open` when a fix
 * above it on its own line (same major) exists and none at or below it on its own minor line
 * does, so the version was never fixed; `fixed` or `unknown` (no fix on its major) otherwise.
 */
function patchReading(version, fixes) {
  const line = fixes.filter((fix) => semver.major(fix) === semver.major(version));
  const next = line.find((fix) => semver.gt(fix, version));
  const previous = line.filter((fix) => semver.lte(fix, version)).at(-1);
  const sameMinor = previous && semver.minor(previous) === semver.minor(version);
  if (next && !sameMinor) return 'open';
  return line.length ? 'fixed' : 'unknown';
}

/**
 * Whether a locked version is hit: `true` inside the written range; `null` (doubt) when the range
 * cannot be read, when it is bare versions with no patched version to check them against, or when
 * the patched versions say the version was never fixed; `false` only when both agree it is safe.
 */
export function inRange(version, range, patched) {
  const readable = semverRange(range);
  if (!readable) return null;
  if (semver.satisfies(version, readable, { includePrerelease: true })) return true;
  const fixes = versionsIn(patched);
  const bare = String(range ?? '')
    .split(/[\s,]+/u)
    .filter(Boolean)
    .every((token) => semver.valid(token));
  if (bare && fixes.length === 0) return null;
  return patchReading(version, fixes) === 'open' ? null : false;
}
