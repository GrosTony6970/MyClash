// Time-overlap conflict detection shared by the Schedule view, the Workshops tab
// and the event's own my-schedule page. Two commitments conflict when their
// windows overlap at all, half-open, by the one rule in `@myclash/schedule-core`.
//
// A window needs a real end. A bout's planned length and a duty's end come from
// the API (ADR-018); an item whose end is unknown has no window and takes no part
// in the check. This file used to add five minutes to every start, and a guessed
// length is what the Event's planner sheet replaced.

import { matchWindowMs, overlapsHalfOpen, type TimeWindowMs } from '@myclash/schedule-core';
import type { RefereeSlot, ScheduleMatch } from './types';

export interface TimedItem extends TimeWindowMs {
  key: string;
  label: string;
}

/** Map of item key → labels of the items it conflicts with (bidirectional). */
export function detectConflicts(items: TimedItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
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

/** A bout as a timed commitment, or null when it has no window. */
export function fightTimed(
  key: string,
  label: string,
  match: Pick<ScheduleMatch, 'scheduledAt' | 'durationMinutes'>,
): TimedItem | null {
  const span = fightWindow(match);
  return span ? { key, label, ...span } : null;
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
