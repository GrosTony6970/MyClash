/**
 * The sessions of the Workshop form (slice 2.1, operator rulings 515, 524, 525). A Workshop may
 * run several sessions: the form holds one line per session (day, start, end, venue), and a save
 * turns the lines into calls. Pure, so what a save sends is tested without the page.
 */
import { isCancelledSession } from '@myclash/schedule-core';
import { minutesIntoDayInZone, zonedDay } from '@myclash/time';
import {
  formatHhmm,
  sessionWrite,
  workshopSessionTimes,
  type PlacedSession,
  type SessionWrite,
} from './workshop-session-times';

/** One session in the form. `id` is null until the session exists. */
export interface SessionLine {
  id: string | null;
  day: string;
  start: string;
  end: string;
  /** The session's venue; '' for none. A new line takes the Workshop's venue (ruling 525). */
  venueId: string;
  /** A cancelled session: locked, struck through; only its ✕ acts, and deletes it (ruling 527). */
  cancelled?: boolean;
}

export interface ExistingSession extends PlacedSession {
  id: string;
  status?: string | null;
}

export type SessionCall =
  | { method: 'PATCH'; line: number; sessionId: string; body: SessionWrite }
  | { method: 'POST'; line: number; body: SessionWrite }
  | { method: 'DELETE'; sessionId: string };

/** "HH:MM" in the Event's zone, the form's own spelling whatever the reader's language. */
const hhmm = (iso: string, tz: string) => {
  const minutes = minutesIntoDayInZone(iso, tz);
  return minutes === null ? '' : (formatHhmm(minutes) ?? '');
};

/** The form's lines for the sessions a Workshop has; one blank line when it has none. */
export function linesOf(
  sessions: readonly ExistingSession[],
  tz: string,
  workshopVenueId: string,
): SessionLine[] {
  if (sessions.length === 0) return [blankLine(workshopVenueId)];
  return sessions.map((s) => ({
    id: s.id,
    day: s.startsAt ? (zonedDay(s.startsAt, tz) ?? '') : '',
    start: s.startsAt ? hhmm(s.startsAt, tz) : '',
    end: s.endsAt ? hhmm(s.endsAt, tz) : '',
    venueId: s.venueId ?? '',
    ...(isCancelledSession(s) ? { cancelled: true } : {}),
  }));
}

export const blankLine = (venueId: string): SessionLine => ({
  id: null,
  day: '',
  start: '',
  end: '',
  venueId,
});

/**
 * The sessions a save removes: an existing session whose line was removed, or whose day or start
 * was cleared. Each is asked about before anything is sent: its bookings go with it. A cancelled
 * line is locked, so only its ✕ removes it: one with no time is not read as cleared (ruling 527).
 */
export function removedSessions(
  lines: readonly SessionLine[],
  existing: readonly ExistingSession[],
  tz: string,
  durationMinutes: number | null,
): ExistingSession[] {
  const kept = new Set(
    lines.filter((l) => l.id && (l.cancelled || timesOf(l, tz, durationMinutes))).map((l) => l.id),
  );
  return existing.filter((s) => !kept.has(s.id));
}

const timesOf = (line: SessionLine, tz: string, durationMinutes: number | null) =>
  workshopSessionTimes({
    day: line.day,
    start: line.start,
    end: line.end || null,
    durationMinutes,
    tz,
  });

/**
 * The calls a save sends, in order: each line's update or creation, then the removals. A line with
 * no day or start is no session: a new one is skipped, an existing one is removed. An existing
 * line is sent only when its times or its venue changed (`sessionWrite`), keeping its room unless
 * its venue changed.
 */
export function sessionEdits(
  lines: readonly SessionLine[],
  existing: readonly ExistingSession[],
  tz: string,
  durationMinutes: number | null,
  workshopVenueId: string,
): SessionCall[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const calls: SessionCall[] = [];
  lines.forEach((line, index) => {
    // A cancelled line is locked: a save never sends it (ruling 527; the server refuses a move).
    if (line.cancelled) return;
    const times = timesOf(line, tz, durationMinutes);
    if (!times) return;
    const venueId = line.venueId || null;
    if (line.id === null) {
      // A new line with no venue takes the Workshop's (ruling 525), as the single session did.
      const venue = venueId ?? (workshopVenueId || null);
      calls.push({ method: 'POST', line: index, body: sessionWrite(times, null, venue, false)! });
      return;
    }
    // A line with an id exists on the server. One the page's list does not hold yet was created
    // by an earlier save whose reload has not landed: it is never posted again.
    const was = byId.get(line.id);
    if (!was) return;
    const body = sessionWrite(times, was, venueId, venueId !== (was.venueId ?? null));
    if (body) calls.push({ method: 'PATCH', line: index, sessionId: was.id, body });
  });
  for (const s of removedSessions(lines, existing, tz, durationMinutes)) {
    calls.push({ method: 'DELETE', sessionId: s.id });
  }
  return calls;
}

/** One call's answer, as far as a save needs it: the id a creation got. */
export type SentCall<F> = { ok: true; id?: string } | { ok: false; failure: F };

/**
 * Send the calls one after the other, and write each created session's id into its line at once.
 * A save that fails half-way keeps the form open with those ids, so saving again updates the
 * sessions already created instead of creating them twice: a creation is no longer an upsert.
 */
export async function applySessionEdits<F>(
  calls: readonly SessionCall[],
  lines: readonly SessionLine[],
  send: (call: SessionCall) => Promise<SentCall<F>>,
): Promise<{ lines: SessionLine[]; failure: F | null }> {
  const next = [...lines];
  for (const call of calls) {
    const sent = await send(call);
    if (!sent.ok) return { lines: next, failure: sent.failure };
    if (call.method === 'POST' && sent.id) next[call.line] = { ...next[call.line]!, id: sent.id };
  }
  return { lines: next, failure: null };
}
