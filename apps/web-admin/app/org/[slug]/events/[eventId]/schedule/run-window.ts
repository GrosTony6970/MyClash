/**
 * The run window's rules (ADR-018): what its bout length field accepts, what
 * the window opens on, and what one save sends.
 *
 * Pure: no React, no fetch. The server lays the run and checks the pistes
 * (`POST /events/:eventId/schedule/run`); this only decides what to ask for.
 */

import { zonedToUtcIso } from '@myclash/time';

/** The longest length the field takes: one day, the API's own ceiling. */
export const MAX_BOUT_LENGTH_MINUTES = 1440;

export type BoutLengthInput =
  { kind: 'blank' } | { kind: 'minutes'; minutes: number } | { kind: 'invalid' };

/**
 * Read the field. Blank means no typed length, so the planner's sheet decides.
 * A whole number of minutes from 1 to a day is a length. Anything else is
 * invalid and the window will not save it. The field is a text input for this
 * reason: a number input reports "" for "abc", which would read as blank and
 * silently clear the run's length.
 */
export function parseBoutLength(raw: string): BoutLengthInput {
  const text = raw.trim();
  if (text === '') return { kind: 'blank' };
  if (!/^\d+$/.test(text)) return { kind: 'invalid' };
  const minutes = Number(text);
  return minutes >= 1 && minutes <= MAX_BOUT_LENGTH_MINUTES
    ? { kind: 'minutes', minutes }
    : { kind: 'invalid' };
}

/**
 * The length the window opens on: the run's typed length when every one of its
 * bouts carries the same one, else blank. A run whose bouts disagree opens blank,
 * and leaving it blank changes nothing (see `planRunWindowSave`).
 */
export function sharedBoutLength(
  runMatchIds: readonly string[],
  cards: ReadonlyArray<{ id: string; plannedDurationOverrideMinutes: number | null }>,
): number | null {
  const typed = new Map(cards.map((card) => [card.id, card.plannedDurationOverrideMinutes]));
  const values = new Set(runMatchIds.map((id) => typed.get(id) ?? null));
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/** The body of `POST /events/:eventId/schedule/run`. */
export interface RunWindowBody {
  matchIds: string[];
  startAt: string;
  /** Sent only when the length changed: a number sets it, null clears it. */
  plannedDurationOverrideMinutes?: number | null;
}

export type RunWindowSave =
  { kind: 'nothing' } | { kind: 'unreadable-start' } | { kind: 'save'; body: RunWindowBody };

/**
 * What one save of the window asks the server for.
 *
 * The start: the run's own instant while its text is untouched. The field shows
 * the grid's 5-minute slot, so reading that text back would move a run at 10:43
 * to 10:40. A changed text is read as the Event's wall clock on the day.
 *
 * The length goes only when it changed. Without it the server keeps every bout's
 * length and the run's spacing, and moves the start.
 */
export function planRunWindowSave(args: {
  runMatchIds: readonly string[];
  runStartIso: string;
  shownStartHHMM: string;
  startHHMM: string;
  openedBoutLength: number | null;
  boutLengthMinutes: number | null;
  day: string;
  tz: string;
}): RunWindowSave {
  const startChanged = args.startHHMM !== args.shownStartHHMM;
  const lengthChanged = args.boutLengthMinutes !== args.openedBoutLength;
  if (!startChanged && !lengthChanged) return { kind: 'nothing' };
  const startAt = startChanged
    ? zonedToUtcIso(args.day, args.startHHMM, args.tz)
    : args.runStartIso;
  if (!startAt) return { kind: 'unreadable-start' };
  return {
    kind: 'save',
    body: {
      matchIds: [...args.runMatchIds],
      startAt,
      ...(lengthChanged ? { plannedDurationOverrideMinutes: args.boutLengthMinutes } : {}),
    },
  };
}
