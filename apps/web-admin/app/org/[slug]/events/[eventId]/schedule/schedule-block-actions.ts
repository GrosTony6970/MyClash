/**
 * What the grid's per-block × (delete) affordance does, decided purely by the
 * block's kind:
 *  - a tournament run (pool / bracket / other) → UNSCHEDULE its matches, so they
 *    drop back into the Unscheduled list (nothing is destroyed),
 *  - an admin / break bar (a programme block) → DELETE the programme block.
 *
 * Pure: no React, no I/O. The caller supplies both ids and this picks one.
 */

export type BlockDeleteAction =
  | { kind: 'unschedule'; matchIds: string[] }
  | { kind: 'delete-block'; blockId: string };

/** Grid block kinds that hold scheduled matches (a "run"), not a programme bar. */
const UNSCHEDULE_KINDS = new Set<string>(['pool', 'bracket', 'other']);

export function blockDeleteAction(input: {
  kind: string;
  matchIds: string[];
  blockId: string;
}): BlockDeleteAction {
  if (UNSCHEDULE_KINDS.has(input.kind)) {
    return { kind: 'unschedule', matchIds: input.matchIds };
  }
  return { kind: 'delete-block', blockId: input.blockId };
}
