/**
 * An instructor busy somewhere else at the same time (rulings 553-555), for the Workshop board's
 * red card. A warning only: nothing is refused.
 *
 * - Teaching: two sessions whose times overlap, in any room, share an instructor. Two sessions of
 *   the SAME Workshop count too (555): instructors belong to the Workshop, so the app cannot know
 *   who takes which room, and the words name the person.
 * - Busy: one of the session's instructors fights (their whole Pool) or referees then, from the
 *   server's answer (`workshop-instructor-busy`).
 *
 * A session counts when it is not cancelled, over `sessionWindowMs`: the window the referee
 * checker reads too (ADR-016), so the two boards agree. Times are half-open, so 10:00-11:00 does not clash with 11:00-12:00. A session with
 * no venue has no card, but it still teaches at its time.
 *
 * Pure: no React, no DOM.
 */
import {
  isCancelledSession,
  overlapsHalfOpen,
  sessionWindowMs,
  type TimeWindowMs,
} from '@myclash/schedule-core';
import type { WorkshopInstructorBusy } from '@myclash/types';

export interface ClashWorkshop {
  title: string;
  instructors: ReadonlyArray<{ globalPersonId: string | null; displayName: string }>;
  sessions: ReadonlyArray<{
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    status?: string | null;
  }>;
}

export interface InstructorClash {
  name: string;
  kind: 'teaches' | 'referees' | 'fights';
  against: string;
}

interface TimedSession {
  sessionId: string;
  title: string;
  window: TimeWindowMs;
  instructors: ReadonlyArray<{ globalPersonId: string; displayName: string }>;
}

function timedSessions(workshops: ReadonlyArray<ClashWorkshop>): TimedSession[] {
  return workshops.flatMap((workshop) => {
    const instructors = workshop.instructors.flatMap((i) =>
      i.globalPersonId ? [{ globalPersonId: i.globalPersonId, displayName: i.displayName }] : [],
    );
    return workshop.sessions.flatMap((session) => {
      const window = isCancelledSession(session) ? null : sessionWindowMs(session);
      return window ? [{ sessionId: session.id, title: workshop.title, window, instructors }] : [];
    });
  });
}

/** Adds a reason once: a Swiss crew is one duty row per bout, and would say it three times. */
function add(out: Map<string, InstructorClash[]>, sessionId: string, clash: InstructorClash) {
  const list = out.get(sessionId) ?? [];
  const seen = list.some(
    (c) => c.name === clash.name && c.kind === clash.kind && c.against === clash.against,
  );
  if (!seen) out.set(sessionId, [...list, clash]);
}

function addTeachingClashes(sessions: TimedSession[], out: Map<string, InstructorClash[]>) {
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i]!;
      const b = sessions[j]!;
      if (!overlapsHalfOpen(a.window, b.window)) continue;
      for (const person of a.instructors) {
        if (!b.instructors.some((other) => other.globalPersonId === person.globalPersonId)) {
          continue;
        }
        add(out, a.sessionId, { name: person.displayName, kind: 'teaches', against: b.title });
        add(out, b.sessionId, { name: person.displayName, kind: 'teaches', against: a.title });
      }
    }
  }
}

function addBusyClashes(
  sessions: TimedSession[],
  busy: ReadonlyArray<WorkshopInstructorBusy>,
  out: Map<string, InstructorClash[]>,
) {
  for (const session of sessions) {
    for (const person of session.instructors) {
      for (const entry of busy) {
        if (entry.personId !== person.globalPersonId) continue;
        const window = { startMs: Date.parse(entry.startsAt), endMs: Date.parse(entry.endsAt) };
        if (!overlapsHalfOpen(session.window, window)) continue;
        add(out, session.sessionId, {
          name: person.displayName,
          kind: entry.kind === 'fight' ? 'fights' : 'referees',
          against: entry.label,
        });
      }
    }
  }
}

/** Session id → why its card is red because of a person. A session with no reason is absent. */
export function instructorClashes(
  workshops: ReadonlyArray<ClashWorkshop>,
  busy: ReadonlyArray<WorkshopInstructorBusy>,
): Map<string, InstructorClash[]> {
  const sessions = timedSessions(workshops);
  const out = new Map<string, InstructorClash[]>();
  addTeachingClashes(sessions, out);
  addBusyClashes(sessions, busy, out);
  return out;
}

/** The instructors the board needs busy times for: a change re-reads them. */
export function instructorKey(workshops: ReadonlyArray<ClashWorkshop>): string {
  const ids = workshops.flatMap((w) =>
    w.instructors.flatMap((i) => (i.globalPersonId ? [i.globalPersonId] : [])),
  );
  return [...new Set(ids)].sort().join(',');
}
