import { blockDeleteAction } from './schedule-block-actions';
import type { MatchPosition } from './useScheduleUndo';

/**
 * The three decisions the board makes about a competition run — a pool, a
 * bracket round, or a loose cluster drawn as one block.
 *
 * Each one used to sit inline in `grid.tsx`, mixed into the writes that carry it
 * out, where none of them could be asserted: whether an × unschedules at all,
 * what undo has to remember to reverse it, whether a lice change is a
 * client-side relocate or a server-side re-fan, and whether the lice selection
 * changed at all.
 *
 * Pure: no React, no fetch, no timezone. A plan says WHAT to write; resolving a
 * slot to an instant and issuing the requests stay with the caller — the same
 * division `block-geometry.ts` and `break-edit-steps.ts` already draw.
 *
 * A run is NOT a programme bar. The bar family (break, admin slot, workshop
 * band) writes to its own resource and lives in ./programme-bar-requests.
 */

/** What the inline × on a run header does. */
export interface RunUnschedulePlan {
  /** The run's own name, for the undo toast. */
  label: string;
  /**
   * Every fight in the run — this is what gets written.
   *
   * Deliberately NOT the same list as `prior`. The writes cover the whole run,
   * while undo can only restore fights the board actually holds a position for.
   * They agree on every board the grid draws today, because a run is built from
   * the fights on it; keeping them separate means a run that ever outgrows that
   * assumption unschedules completely rather than partially.
   */
  matchIds: string[];
  /** Where each of those fights was sitting. Undo's captured inverse. */
  prior: Array<{ id: string } & MatchPosition>;
}

/**
 * Decide the × on a run header.
 *
 * Returns null when there is nothing to do — the block is a programme bar
 * (whose × deletes rather than unschedules), or the run holds no fight the board
 * knows about. Null means "push no undo entry either": an entry that restores
 * nothing is worse than no entry, because it consumes a Ctrl+Z.
 */
export function runUnschedulePlan(args: {
  block: {
    kind: string;
    key: string;
    label: string;
    matches: ReadonlyArray<{ id: string }>;
  };
  /** Every fight the board holds, not just this run's. */
  matches: ReadonlyArray<{ id: string } & MatchPosition>;
}): RunUnschedulePlan | null {
  const { block, matches } = args;
  const action = blockDeleteAction({
    kind: block.kind,
    matchIds: block.matches.map((m) => m.id),
    blockId: block.key,
  });
  if (action.kind !== 'unschedule') return null;

  const ids = new Set(action.matchIds);
  const prior = matches
    .filter((m) => ids.has(m.id))
    .map((m) => ({ id: m.id, liceId: m.liceId, scheduledAt: m.scheduledAt }));
  if (prior.length === 0) return null;

  return { label: block.label, matchIds: action.matchIds, prior };
}

/**
 * Did the operator actually change which lices a run sits on?
 *
 * Order-insensitive: the popover's checkboxes append in click order, so the same
 * two lices ticked in the other sequence is the same selection. Asking this
 * before writing is what keeps a save that only moved the start time from firing
 * a full re-fan across the board.
 */
export function liceSelectionChanged(current: readonly string[], next: readonly string[]): boolean {
  const a = [...current].sort();
  const b = [...next].sort();
  return a.length !== b.length || a.some((value, i) => value !== b[i]);
}

/**
 * How a run moves to a new set of lices.
 *
 * A bracket re-fan is branch-aware — which fight may share a lice with which
 * depends on the tree — so it goes to the server. A pool has no such structure:
 * it relocates onto the single target lice client-side, displacing whatever sits
 * there, which is the same placement the operator would get by dragging it.
 */
export type BlockLiceChange =
  | { mode: 'refan'; matchIds: string[]; liceIds: string[] }
  | { mode: 'relocate'; matchIds: string[]; liceId: string };

/** Null when no lice was selected — there is nowhere to move the run to. */
export function blockLiceChange(
  block: { kind: string; matches: ReadonlyArray<{ id: string }> },
  newLiceIds: readonly string[],
): BlockLiceChange | null {
  const liceId = newLiceIds[0];
  if (!liceId) return null;
  const matchIds = block.matches.map((m) => m.id);
  return block.kind === 'bracket'
    ? { mode: 'refan', matchIds, liceIds: [...newLiceIds] }
    : { mode: 'relocate', matchIds, liceId };
}
