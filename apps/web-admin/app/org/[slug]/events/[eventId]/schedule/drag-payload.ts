import type { ScheduleMatch } from './schedule-types';

/**
 * What the operator is currently dragging on the schedule board.
 *
 * There used to be six refs — one per draggable thing — and every one of the
 * eight drag-start sites was expected to null the other five by hand. None of
 * them did. Two were outright wrong: the Detailed view's match card nulled
 * nothing at all, and its programme bar left a bracket-round payload standing.
 * Both were masked, one by the order the drop handler happened to test the refs
 * in and one by every OTHER site having an `onDragEnd`.
 *
 * One slot holding a discriminated union makes a leftover inexpressible: a
 * drag-start overwrites, it does not have to remember what to erase.
 *
 * Pure: no React. The ref that holds one of these lives in the component, and
 * the views never see it — they get a begin/end callback pair instead, so
 * nothing below the board can read or forget to clear the payload.
 */
export type DragPayload =
  | { kind: 'match'; match: ScheduleMatch }
  | { kind: 'pool'; poolId: string; matchIds: string[] }
  | { kind: 'bracketRound'; key: string; matchIds: string[] }
  | { kind: 'block'; id: string; startTime: string }
  | { kind: 'viewBlock'; matchIds: string[] }
  | { kind: 'viewBreak'; id: string; startTime: string };

/**
 * The matches a payload moves as one group.
 *
 * Empty for the two programme-bar payloads: a bar is not a set of fights, it is
 * a time window that cascades whatever sits after it. The Blocks view drops
 * them through this helper and ends up doing nothing, which is what it did
 * before — its old fallback chain could only ever yield an empty list for a
 * bar, and the group placer returns early on one.
 */
export function draggedMatchIds(payload: DragPayload | null): string[] {
  if (!payload) return [];
  switch (payload.kind) {
    case 'match':
      return [payload.match.id];
    case 'pool':
    case 'bracketRound':
    case 'viewBlock':
      return payload.matchIds;
    case 'block':
    case 'viewBreak':
      return [];
  }
}
