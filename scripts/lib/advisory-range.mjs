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

/** Each version a `patched_versions` text names, with its operator (`≤`/`≥` read as `<=`/`>=`). */
function patchedTokens(text) {
  const normal = String(text ?? '')
    .replace(/≤/gu, '<=')
    .replace(/≥/gu, '>=');
  const token = /(<=|>=|<|>|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gu;
  return [...normal.matchAll(token)]
    .map(([, operator = '', version]) => ({ operator, version }))
    .filter(({ version }) => semver.valid(version));
}

/**
 * The fixes a `patched_versions` text names (`>= 6.3.3`, `19.0.1, 19.1.2`), oldest first. A version
 * after `<` or `<=` is a patched range's upper bound (`>= 6.3.3 < 7.0.0`), and one after `>` is
 * not itself patched: neither is a fix.
 */
export function versionsIn(text) {
  return patchedTokens(text)
    .filter(({ operator }) => !operator.startsWith('<') && operator !== '>')
    .map(({ version }) => version)
    .sort(semver.compare);
}

/** A patched range's upper bounds (`< 7.0.0` in `>= 6.3.3 < 7.0.0`): past one, a fix stops. */
function boundsIn(text) {
  return patchedTokens(text)
    .filter(({ operator }) => operator.startsWith('<'))
    .map(({ version }) => version);
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
 * Whether a locked version is hit: `true` inside the written range; `false` only when the patched
 * versions positively say it is fixed too (a fix at or below it on its own line, or every fix
 * below it: our astro 7 against an astro 5 fix); `null` (doubt) otherwise: the range cannot be
 * read, no patched version is given, a fix above it was never matched on its own line, or the
 * only fixes sit on a later major (astro's bare `6.3.1`, patched `>= 6.3.3`: reviewed `< 6.3.3`,
 * so astro 5 is hit). A repository advisory whose own patched field is wrong cannot be caught
 * before review (vitest's `<3.2.5`, patched `3.2.5`; reviewed `< 3.2.6`): pnpm audit owns it then.
 */
export function inRange(version, range, patched) {
  const readable = semverRange(range);
  if (!readable) return null;
  if (semver.satisfies(version, readable, { includePrerelease: true })) return true;
  const fixes = versionsIn(patched);
  if (fixes.length === 0) return null;
  if (pastAPatchedBound(version, fixes, boundsIn(patched))) return null;
  if (rangeOutrunsItsFixes(version, readable, fixes)) return null;
  const reading = patchReading(version, fixes);
  if (reading === 'fixed') return false;
  if (reading === 'unknown' && semver.gt(version, fixes.at(-1))) return false;
  return null;
}

/**
 * A range that reaches the version's major with no fix on that major above all it reaches there:
 * no fix vouches for the version (`<= 8.13.6` with a sibling entry's `8.5.0` says nothing of
 * 8.13.7), nor does a fix an advisory's own list passes (`2.0.0, 2.2.0` patched `2.1.0`). Only
 * the version's own major counts, so a range that spans majors (`1.8.0, 2.2.0`, patched `1.9.0`)
 * still lets 1.9.0 vouch for 1.9.5.
 */
function rangeOutrunsItsFixes(version, readable, fixes) {
  const major = semver.major(version);
  const top = `<${major + 1}.0.0-0`;
  if (!semver.intersects(readable, `>=${major}.0.0 ${top}`)) return false;
  return !fixes.some(
    (fix) => semver.major(fix) === major && !semver.intersects(readable, `>=${fix} ${top}`),
  );
}

/** At or past a patched range's upper bound, with no fix between that bound and the version. */
function pastAPatchedBound(version, fixes, bounds) {
  return bounds.some(
    (bound) =>
      semver.gte(version, bound) &&
      !fixes.some((fix) => semver.gte(fix, bound) && semver.lte(fix, version)),
  );
}

/** A name as a hand may write it: no `@`, no owner, no `.js`, lower case (`withastro/astro`). */
function looseName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/\.js$/u, '')
    .split('/')
    .at(-1);
}

/**
 * Which of `names` an advisory's package name means: itself when it is spelled as npm spells it,
 * or the one it loosely names (`withastro/astro` for astro, `luxon.js` for luxon), else none.
 */
export function packageNamed(written, names) {
  if (names.includes(written)) return written;
  const loose = looseName(written);
  return loose ? (names.find((name) => looseName(name) === loose) ?? null) : null;
}
