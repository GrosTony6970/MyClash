import semver from 'semver';

/**
 * How a GitHub repository advisory's `vulnerable_version_range` reads, against the locked
 * version of a dependency (scripts/check-repo-advisories.mjs). Repository advisories are written by
 * hand, before GitHub reviews them: the shapes below are the ones the 66 repositories our direct
 * dependencies come from actually use. Whatever no rule reads is unreadable (null), so a person
 * reads it: never a silent pass.
 */

/**
 * Versions named in a text (`>= 6.3.3`, `19.0.1, 19.1.2`), oldest first.
 */
export function versionsIn(text) {
  const found = String(text ?? '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu) ?? [];
  return found.filter((version) => semver.valid(version)).sort(semver.compare);
}

/**
 * Bare versions read against the versions that fixed them. A repository advisory's bare version
 * is not always "only this one": mermaid's `8.13.6` and astro's `6.3.1` are `< 8.13.8` and
 * `< 6.3.3` in GitHub's reviewed copies. So one version reads as "below the lowest patched
 * version above it", and each version of a list (React's `19.0.0, 19.1.0`) as "from it to its
 * patch". With no patched version to read against, the text is unreadable (null): a person reads
 * it, the check never passes it.
 */
function versionListRange(tokens, patched) {
  const fixes = versionsIn(patched);
  if (fixes.length === 0) return null;
  const fixOf = (version) => fixes.find((fix) => semver.gt(fix, version));
  if (tokens.length === 1) {
    const fix = fixOf(tokens[0]);
    return fix ? `<${fix}` : `>=${tokens[0]}`;
  }
  return tokens
    .map((version) => (fixOf(version) ? `>=${version} <${fixOf(version)}` : `>=${version}`))
    .join(' || ');
}

/** A comparator set with two upper or two lower bounds: written as an OR, read as an AND. */
function narrowedByAnd(written) {
  return new semver.Range(written).set.some((comparators) => {
    const operators = comparators.map((comparator) => comparator.operator);
    const upper = operators.filter((operator) => operator.startsWith('<')).length;
    const lower = operators.filter((operator) => operator.startsWith('>')).length;
    return upper > 1 || lower > 1;
  });
}

/**
 * GitHub's range as node-semver reads it, or null when unreadable. GitHub writes a range
 * (`>= 12.0.0, < 12.5.0`, the comma an AND) or bare versions (see versionListRange). Unreadable
 * too: a range no version satisfies (`>= 12.0.0, < 11.2.4`), and one with two upper or two lower
 * bounds (`<7.119.1, <8.33.0`, `>= 13.3, >= 14`), whose comma meant OR: read as an AND it would
 * narrow the range and pass the versions it dropped.
 */
export function semverRange(range, patched) {
  const text = String(range ?? '').trim();
  const tokens = text.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => semver.valid(token))) {
    return versionListRange(tokens, patched);
  }
  const written = text.replace(/,\s*/gu, ' ').replace(/=</gu, '<=').replace(/=>/gu, '>=');
  if (!written || !semver.validRange(written) || !semver.minVersion(written)) return null;
  return narrowedByAnd(written) ? null : written;
}

/** Whether a locked version sits in an advisory's range; `null` when the range is unreadable. */
export function inRange(version, range, patched) {
  const readable = semverRange(range, patched);
  return readable ? semver.satisfies(version, readable, { includePrerelease: true }) : null;
}
