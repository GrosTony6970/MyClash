/**
 * What changed in a Tournament's forfeit rules (the audited settings change, revisions 13-16 of its
 * plan; operator rulings 142, 145, 147).
 *
 * The diff is over the rules IN FORCE (the penalty ruleset's, with the Tournament's stored changes
 * laid over them), so the notice reads "disqualify after: off → 2" whichever key moved. Ruling 147:
 * a stored change whose value equals the ruleset's moves nothing in force, yet changes what the
 * Tournament holds; it is an entry too, marked `stored` (`set` or `reset`), and it locks like any.
 *
 * Fail closed, as `scoringDiff` is: a leaf of the rules in force that the path list does not hold,
 * or a stored change outside the listed leaves (a restored `{}` deep down), is ONE entry
 * `forfeitRules.unknown`, carried as a path with no value.
 *
 * Pure.
 */
import { FORFEIT_RULE_LEAF_PATHS, FORFEIT_UNKNOWN_PATH, type RulesChange } from '@myclash/types';
import type { ForfeitChanges, ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { stableStringify } from './content-hash';

const PREFIX = 'forfeitRules.';

/** Each listed leaf, as its key segments under the rules (`reasons.injury.outcome`). */
const LISTED = FORFEIT_RULE_LEAF_PATHS.map((path) => path.slice(PREFIX.length).split('.'));

/**
 * Every change between two sides: one entry per listed leaf whose value in force or whose stored
 * presence changed, in `FORFEIT_RULE_LEAF_PATHS` order, then one `forfeitRules.unknown` when
 * anything outside the list changed.
 */
export function forfeitRulesChanges(
  inForceBefore: ForfeitRulesInForce,
  inForceAfter: ForfeitRulesInForce,
  storedBefore: ForfeitChanges | null,
  storedAfter: ForfeitChanges | null,
): RulesChange[] {
  const changes: RulesChange[] = [];
  FORFEIT_RULE_LEAF_PATHS.forEach((path, i) => {
    const segments = LISTED[i]!;
    const before = valueAt(inForceBefore, segments);
    const after = valueAt(inForceAfter, segments);
    if (stableStringify(before ?? null) !== stableStringify(after ?? null)) {
      changes.push({ path, before, after });
      return;
    }
    const wasStored = valueAt(storedBefore, segments) !== undefined;
    const isStored = valueAt(storedAfter, segments) !== undefined;
    if (wasStored !== isStored) {
      changes.push({ path, before, after, stored: isStored ? 'set' : 'reset' });
    }
  });
  if (unlistedChanged(inForceBefore, inForceAfter) || unlistedChanged(storedBefore, storedAfter)) {
    changes.push({ path: FORFEIT_UNKNOWN_PATH, before: null, after: null });
  }
  return changes;
}

/** Whether a leaf no listed path covers differs between two trees. */
function unlistedChanged(before: unknown, after: unknown): boolean {
  const leaves = [...leavesOf(before), ...leavesOf(after)];
  return leaves.some(
    (leaf) =>
      !LISTED.some((path) => isPrefix(path, leaf)) &&
      stableStringify(valueAt(before, leaf) ?? null) !==
        stableStringify(valueAt(after, leaf) ?? null),
  );
}

/**
 * Every leaf of a tree, as its key segments. A leaf is anything but a non-empty plain object: an
 * empty object is one (a restored `{}` must still be seen).
 */
function leavesOf(value: unknown, prefix: string[] = [], out: string[][] = []): string[][] {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) leavesOf(child, [...prefix, key], out);
  } else if (prefix.length > 0) {
    out.push(prefix);
  }
  return out;
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let value = root;
  for (const segment of segments) {
    if (!isPlainObject(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function isPrefix(path: readonly string[], leaf: readonly string[]): boolean {
  return path.length <= leaf.length && path.every((segment, i) => segment === leaf[i]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
