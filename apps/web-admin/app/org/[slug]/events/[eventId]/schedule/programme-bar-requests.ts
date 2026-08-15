import type { BreakEditStep } from './break-edit-steps';
import type { MutateInit } from './schedule-mutations';
import type { ProgrammeBlockRow } from './schedule-types';

/**
 * Every request the programme-bar family sends, in one place.
 *
 * A programme bar is a non-fight row on the board — a break, an admin slot, a
 * workshop band. All five of its mutations hit the same resource under
 * `/events/:eventId/programme/blocks`, and until this module existed that base
 * path was written out by hand at EIGHT call sites inside `grid.tsx`: create,
 * re-create-after-undo, move, resize-end, resize-start, relabel, delete, and
 * the three-step popover save. Eight literals for one resource is the shape
 * where a path change fixes seven places and misses the eighth.
 *
 * Pure: no React, no fetch, no timezone, no i18n. A request here is data — a URL
 * and a `MutateInit` — and the caller hands it to `mutateSchedule`. That is what
 * makes the verb and the body assertable, which matters most for
 * `barEditRequest`: the three popover steps go to three DIFFERENT endpoints, and
 * only one of them cascades.
 *
 * Slot-to-HH:MM conversion is NOT here. It needs the axis origin, which is
 * derived per day from the programme itself, so it stays with the caller — the
 * same division `block-geometry.ts` draws between slot arithmetic and the
 * timezone.
 */

/** One write, ready to hand to `mutateSchedule`. */
export interface BarRequest {
  url: string;
  init: MutateInit;
}

/** Which event's programme is being edited. */
export interface ProgrammeTarget {
  apiUrl: string;
  eventId: string;
}

/**
 * The POST body for a new bar.
 *
 * `colorHex` is optional rather than nullable-required on purpose: the undo path
 * re-creates a deleted bar from a snapshot that never captured a colour, and it
 * has always POSTed without the key. Sending an explicit `null` there instead
 * would be a different request — so the field is omitted when the caller omits
 * it, and serialised as `null` when the caller passes `null`.
 */
export interface NewBarBody {
  dayIndex: number;
  blockType: ProgrammeBlockRow['blockType'];
  label: string;
  startTime: string;
  endTime: string;
  colorHex?: string | null;
}

/** The collection every bar request is rooted at. The one owner of this path. */
function barsUrl(target: ProgrammeTarget): string {
  return `${target.apiUrl}/api/v1/events/${target.eventId}/programme/blocks`;
}

function barUrl(target: ProgrammeTarget, blockId: string): string {
  return `${barsUrl(target)}/${blockId}`;
}

export function createBarRequest(target: ProgrammeTarget, body: NewBarBody): BarRequest {
  return { url: barsUrl(target), init: { method: 'POST', body } };
}

/** Bodyless on purpose — `mutateSchedule` omits the Content-Type header without
 *  one, which is what this endpoint has always been sent. */
export function deleteBarRequest(target: ProgrammeTarget, blockId: string): BarRequest {
  return { url: barUrl(target, blockId), init: { method: 'DELETE' } };
}

/**
 * Retime a bar. CASCADES: every later bar on the day moves with it, and the
 * bar's own end is carried along to preserve its duration.
 */
export function moveBarRequest(
  target: ProgrammeTarget,
  blockId: string,
  newStartTime: string,
): BarRequest {
  return {
    url: `${barUrl(target, blockId)}/move`,
    init: { method: 'PATCH', body: { newStartTime } },
  };
}

/** Drag the bottom edge: the end moves, the start and the rest of the day do not. */
export function resizeBarEndRequest(
  target: ProgrammeTarget,
  blockId: string,
  newEndTime: string,
): BarRequest {
  return {
    url: `${barUrl(target, blockId)}/resize`,
    init: { method: 'PATCH', body: { newEndTime } },
  };
}

/**
 * Drag the top edge: the start moves, the end stays put.
 *
 * Same endpoint as the bottom-edge resize, and deliberately NOT `/move` — this
 * gesture means "this bar gets shorter", not "the day shifts".
 */
export function resizeBarStartRequest(
  target: ProgrammeTarget,
  blockId: string,
  newStartTime: string,
): BarRequest {
  return {
    url: `${barUrl(target, blockId)}/resize`,
    init: { method: 'PATCH', body: { newStartTime } },
  };
}

/**
 * One popover step as a request.
 *
 * `breakEditSteps` decides WHICH steps to send and in what order; this decides
 * where each one goes. Splitting it that way is why the ordering rule and the
 * routing can both be asserted — a `move` step reaching `/resize` would silently
 * stop the day cascading, and nothing about the step's own shape would show it.
 */
export function barEditRequest(
  target: ProgrammeTarget,
  blockId: string,
  step: BreakEditStep,
): BarRequest {
  switch (step.kind) {
    case 'label':
      return {
        url: barUrl(target, blockId),
        init: { method: 'PATCH', body: { label: step.label, colorHex: step.colorHex } },
      };
    case 'move':
      return moveBarRequest(target, blockId, step.newStartTime);
    case 'resize':
      return resizeBarEndRequest(target, blockId, step.newEndTime);
  }
}
