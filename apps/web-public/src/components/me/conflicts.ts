// Time-overlap conflict detection shared by the Schedule view, the Workshops tab
// and the event's own my-schedule page. Two commitments conflict when their
// windows overlap at all, half-open, by the one rule in `@myclash/schedule-core`.
//
// A window needs a real end. A bout's planned length and a duty's end come from
// the API (ADR-018); an item whose end is unknown has no window and takes no part
// in the check. This file used to add five minutes to every start, and a guessed
// length is what the Event's planner sheet replaced.
//
// A fighter is busy for their whole Pool, not only their own bouts (operator,
// 2026-09-17): the Pool's span — first placed bout to the end of its last,
// whoever fights them — is a commitment too, and clashes like any other.

import { matchWindowMs, overlapsHalfOpen, type TimeWindowMs } from '@myclash/schedule-core';
import type { PoolSpan, RefereeSlot, ScheduleMatch } from './types';

export interface TimedItem extends TimeWindowMs {
  key: string;
  label: string;
  /** On a bout: the Pool it belongs to. */
  poolId?: string;
  /** On a Pool's span: the Pool it spans. */
  spanOf?: string;
}

/**
 * A Pool's span never clashes with its own bouts, which it covers by definition.
 * Two bouts of one Pool still can: a Pool may run on two pistes at once.
 */
const covers = (span: TimedItem, bout: TimedItem): boolean =>
  span.spanOf !== undefined && span.spanOf === bout.poolId;

/** Map of item key → labels of the items it conflicts with (bidirectional). */
export function detectConflicts(items: TimedItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      if (covers(a, b) || covers(b, a)) continue;
      if (overlapsHalfOpen(a, b)) {
        conflicts.set(a.key, [...(conflicts.get(a.key) ?? []), b.label]);
        conflicts.set(b.key, [...(conflicts.get(b.key) ?? []), a.label]);
      }
    }
  }
  return conflicts;
}

/** A commitment with a readable start AND end, or null: no end, no window. */
export function toTimed(
  key: string,
  label: string,
  startIso: string | null,
  endIso: string | null,
): TimedItem | null {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return { key, label, startMs, endMs };
}

/**
 * A bout's planned window: its start plus its planned length. Null when either is
 * unknown. The API sends no length when it cannot read the Event's sheet, and a
 * schedule cached before it sent one has no such field at all; `matchWindowMs`
 * throws on both, and here it would throw during render.
 */
export function fightWindow(
  match: Pick<ScheduleMatch, 'scheduledAt' | 'durationMinutes'>,
): TimeWindowMs | null {
  const { scheduledAt, durationMinutes } = match;
  if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) return null;
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes)) return null;
  if (durationMinutes <= 0) return null;
  return matchWindowMs(scheduledAt, durationMinutes);
}

/** What the two functions below need of a bout. Each page keeps its own bout type. */
type Bout = Pick<ScheduleMatch, 'id' | 'scheduledAt' | 'durationMinutes' | 'poolId'>;

const poolSpanKey = (poolId: string): string => `pool-${poolId}`;

/**
 * A fighter's bouts AND the spans of their Pools, as timed items — together,
 * because they come from the same bouts, and a page that took the bouts without
 * the spans would drop the whole-Pool rule in silence. A bout with no window is
 * left out; its Pool's span still takes part. Each page names its own bout keys.
 *
 * `poolSpans` is absent in a schedule cached before the API sent it: the /me
 * pages paint that copy first, and nothing validates it.
 */
export function fightItems<M extends Bout>(
  schedule: { matches: readonly M[]; poolSpans?: readonly PoolSpan[] },
  boutKey: (match: M) => string,
  labelOf: (match: M) => string,
): TimedItem[] {
  const bouts = schedule.matches.flatMap((match): TimedItem[] => {
    const window = fightWindow(match);
    if (!window) return [];
    const poolId = match.poolId ?? undefined;
    return [{ key: boutKey(match), label: labelOf(match), ...window, poolId }];
  });
  const spans = (schedule.poolSpans ?? []).flatMap((span): TimedItem[] => {
    const label = [span.poolName, span.tournamentName].filter(Boolean).join(' · ');
    const timed = toTimed(poolSpanKey(span.poolId), label, span.startsAt, span.endsAt);
    return timed ? [{ ...timed, spanOf: span.poolId }] : [];
  });
  return [...bouts, ...spans];
}

/**
 * A Pool's span has no card of its own, so what it clashes with is shown on its
 * Pool's bout cards — every one of them, a bout with no window included, since it
 * is still in the Pool (operator, 2026-09-18). A bout that also clashes with the
 * same item directly lists it once.
 */
export function spreadPoolConflicts<M extends Bout>(
  conflicts: Map<string, string[]>,
  schedule: { matches: readonly M[] },
  boutKey: (match: M) => string,
): Map<string, string[]> {
  const spread = new Map(conflicts);
  for (const match of schedule.matches) {
    const fromSpan = match.poolId ? conflicts.get(poolSpanKey(match.poolId)) : undefined;
    if (!fromSpan) continue;
    const key = boutKey(match);
    spread.set(key, [...new Set([...(spread.get(key) ?? []), ...fromSpan])]);
  }
  return spread;
}

/**
 * A referee duty as a timed commitment: the window the API works out from the
 * Matches the duty covers, its own Match or its Pool's placed Matches (ADR-017).
 * A Pool duty has no Match time of its own, so this is the only window it has.
 * Null when the API does not know the duty's end.
 */
export function dutyTimed(
  key: string,
  label: string,
  duty: Pick<RefereeSlot, 'startsAt' | 'endsAt'>,
): TimedItem | null {
  return toTimed(key, label, duty.startsAt, duty.endsAt);
}
