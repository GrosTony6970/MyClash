/**
 * Pure helpers for the workshop scheduling fields.
 *
 * The create/edit form has three optional inputs — Start (HH:MM),
 * End (HH:MM) and Duration (minutes) — that auto-complete each other:
 *   - Start + End      → Duration   (end − start)
 *   - Start + Duration → End        (start + duration)
 * Plus a builder that turns Day + Start + (End | Duration) into the
 * ISO-ish local datetime strings the session endpoint expects.
 *
 * All functions are pure and total: invalid/missing input yields null
 * rather than throwing, so the reducer can call them on every keystroke.
 */

import { zonedToUtcIso } from '@myclash/time';

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** Parse "HH:MM" → minutes-since-midnight, or null when malformed/out-of-range. */
export function parseHhmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = HHMM.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Format minutes-since-midnight → "HH:MM" (null if outside a single day). */
export function formatHhmm(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Duration in minutes between two HH:MM times; null if invalid or end ≤ start. */
export function durationFromStartEnd(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const s = parseHhmm(start);
  const e = parseHhmm(end);
  if (s === null || e === null) return null;
  const diff = e - s;
  return diff > 0 ? diff : null;
}

/** End time (HH:MM) from a start time + a duration; null if invalid or it spills past midnight. */
export function endFromStartDuration(
  start: string | null | undefined,
  durationMinutes: number | null | undefined,
): string | null {
  const s = parseHhmm(start);
  if (s === null || durationMinutes === null || durationMinutes === undefined) return null;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  return formatHhmm(s + durationMinutes);
}

export interface SessionTimesInput {
  day: string | null | undefined; // YYYY-MM-DD
  start: string | null | undefined; // HH:MM
  end?: string | null; // HH:MM
  durationMinutes?: number | null;
  tz: string; // event IANA timezone
}

export interface SessionTimes {
  startTime: string; // UTC ISO instant
  endTime: string; // UTC ISO instant
}

/**
 * Build the {startTime,endTime} UTC instants for the session endpoint, or
 * null when there is not enough information to schedule (no day/start/tz).
 * The wall-clock day+time are interpreted in the event timezone. End is
 * taken from `end`, else derived from `durationMinutes`, else a 60-minute
 * default.
 */
/** The session a Workshop's form edits, as the page holds it. */
export interface PlacedSession {
  startsAt: string | null;
  endsAt: string | null;
  venueId: string | null;
  areaId: string | null;
}

/** A null venue or room clears it: a session is updated with only the fields it is sent. */
export interface SessionWrite extends SessionTimes {
  venueId?: string | null;
  areaId?: string | null;
}

const sameInstant = (a: string, b: string | null): boolean =>
  b !== null && new Date(a).getTime() === new Date(b).getTime();

/**
 * What the Workshop's form sends for its session, or null when the session is to stay as it is.
 *
 * The form re-sent the session at every save, with the Workshop's default venue and no room: a
 * typo fixed in the title wiped the room the board had given the session, and since 2026-11-09
 * told its people the session had moved. It is now sent when its day or times changed, keeping its
 * own venue and room; or when the organiser picked another venue (`venueChanged`), which takes the
 * session there, and out of a room of the old venue: the room is sent as null, because an update
 * keeps every field it is not sent. A new session takes the form's venue.
 */
export function sessionWrite(
  times: SessionTimes,
  existing: PlacedSession | null,
  formVenueId: string | null,
  venueChanged: boolean,
): SessionWrite | null {
  if (!existing) return { ...times, venueId: formVenueId ?? undefined };
  if (venueChanged) return { ...times, venueId: formVenueId, areaId: null };
  if (
    sameInstant(times.startTime, existing.startsAt) &&
    sameInstant(times.endTime, existing.endsAt)
  ) {
    return null;
  }
  return {
    ...times,
    venueId: existing.venueId ?? formVenueId ?? undefined,
    areaId: existing.areaId ?? undefined,
  };
}

export function workshopSessionTimes(input: SessionTimesInput): SessionTimes | null {
  const { day, start, tz } = input;
  if (!day || !start || !tz) return null;
  if (parseHhmm(start) === null) return null;

  const endHhmm =
    (input.end && parseHhmm(input.end) !== null ? input.end : null) ??
    endFromStartDuration(start, input.durationMinutes ?? null) ??
    endFromStartDuration(start, 60);
  if (!endHhmm) return null;

  const startTime = zonedToUtcIso(day, start, tz);
  const endTime = zonedToUtcIso(day, endHhmm, tz);
  if (!startTime || !endTime) return null;
  return { startTime, endTime };
}
