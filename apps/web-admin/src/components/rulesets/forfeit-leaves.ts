import {
  FORFEIT_RULE_REASONS,
  type ForfeitChanges,
  type ForfeitPatch,
  type ForfeitRulesInForce,
} from '@myclash/types/forfeit-rules';

/**
 * The leaves of the forfeit rules a Tournament may change (ruling 65), as paths: a reason's three
 * fields, the three counts and the two black cards. A Tournament's form holds its changes as a
 * `ForfeitPatch`, set and reset leaf by leaf here, so the badge, the Reset and the save agree.
 */
export type ForfeitLeaf = readonly string[];

const REASON_FIELDS = ['outcome', 'opponentScore', 'fighter'] as const;

export const FORFEIT_LEAVES: readonly ForfeitLeaf[] = [
  ...FORFEIT_RULE_REASONS.flatMap((reason) =>
    REASON_FIELDS.map((field) => ['reasons', reason, field] as const),
  ),
  ['disqualifyAfter'],
  ['disqualifyBeforeFirstBout'],
  ['blackCardOpponentScore'],
  ['firstBlackCard'],
  ['secondBlackCard'],
];

type Tree = Record<string, unknown>;
type Changes = ForfeitPatch | ForfeitChanges | ForfeitRulesInForce;

const isTree = (value: unknown): value is Tree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `leaf`, or undefined when a key on the way is absent. */
export function leafOf(tree: Changes | null, leaf: ForfeitLeaf): unknown {
  let at: unknown = tree;
  for (const key of leaf) at = isTree(at) ? at[key] : undefined;
  return at;
}

/** `tree` with `value` at `leaf`, a copy. */
export function withLeaf(
  tree: ForfeitPatch | null,
  leaf: ForfeitLeaf,
  value: unknown,
): ForfeitPatch {
  const [key, ...rest] = leaf;
  const source = (tree ?? {}) as Tree;
  const child = rest.length
    ? withLeaf((isTree(source[key!]) ? source[key!] : null) as ForfeitPatch | null, rest, value)
    : value;
  return { ...source, [key!]: child } as ForfeitPatch;
}

/** `tree` without `leaf`, and without a parent it leaves empty; nothing left is null. */
export function withoutLeaf(tree: ForfeitPatch | null, leaf: ForfeitLeaf): ForfeitPatch | null {
  if (!tree) return null;
  const [key, ...rest] = leaf;
  const next: Tree = { ...(tree as Tree) };
  const child = rest.length ? withoutLeaf(next[key!] as ForfeitPatch | null, rest) : null;
  if (child && Object.keys(child).length) next[key!] = child;
  else delete next[key!];
  return Object.keys(next).length ? (next as ForfeitPatch) : null;
}

/**
 * The Reset of `leaf` (plan C4): a leaf the saved changes hold is set to null, which the save
 * sends and the server deletes; a leaf only the form holds is removed, with the parents it
 * empties, so an edit undone leaves the form as it was read.
 */
export function resetLeaf(
  form: ForfeitPatch | null,
  saved: ForfeitChanges | null,
  leaf: ForfeitLeaf,
): ForfeitPatch | null {
  return leafOf(saved, leaf) === undefined ? withoutLeaf(form, leaf) : withLeaf(form, leaf, null);
}

/**
 * The form after a field shows `next` where it showed `shown`: each leaf that moved is set. A leaf
 * moved back to the ruleset's value that the saved changes do not hold is removed instead: an
 * edit undone by hand is no change, and once a bout has started a change would refuse the Save.
 */
export function editedForm(
  form: ForfeitPatch | null,
  shown: ForfeitRulesInForce,
  next: ForfeitRulesInForce,
  { ruleset, saved }: { ruleset: ForfeitRulesInForce; saved: ForfeitChanges | null },
): ForfeitPatch | null {
  return FORFEIT_LEAVES.reduce<ForfeitPatch | null>((acc, leaf) => {
    const value = leafOf(next, leaf);
    if (value === leafOf(shown, leaf)) return acc;
    const undone = value === leafOf(ruleset, leaf) && leafOf(saved, leaf) === undefined;
    return undone ? withoutLeaf(acc, leaf) : withLeaf(acc, leaf, value);
  }, form);
}

/** The badge: the form holds a change of `leaf`, whatever its value (a Reset not saved is none). */
export const isChanged = (form: ForfeitPatch | null, leaf: ForfeitLeaf): boolean =>
  leafOf(form, leaf) != null;
