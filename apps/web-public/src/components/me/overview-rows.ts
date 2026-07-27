// Pure row builders for the /me event-overview sections. Every section on that
// page reads as a "what do I do next" list, so every section is ordered by time
// with unscheduled entries last. Kept framework-free so the ordering can be
// unit-tested in isolation — same shape as `workshop-rows.ts`, which already
// does this for the Workshops section.

import type { MyEventRefereeOf, MyEventTournament, ScheduleMatch } from './types';

/** ISO comparator: ascending, `null` (unscheduled) always last. */
function byIsoNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

/** A referee assignment joined to the tournament it belongs to (for deep-linking). */
export interface RefereeRow extends MyEventRefereeOf {
  tournament: MyEventTournament | null;
}

/**
 * Referee assignments joined to their tournament by name, ordered by start time
 * with unscheduled duties last. Ties break on end time then tournament name so
 * two duties sharing a start never swap places between renders.
 */
export function buildRefereeRows(
  refereeOf: MyEventRefereeOf[],
  tournaments: MyEventTournament[],
): RefereeRow[] {
  return refereeOf
    .map((r) => ({
      ...r,
      tournament: tournaments.find((tr) => tr.name === r.tournamentName) ?? null,
    }))
    .sort(
      (a, b) =>
        byIsoNullsLast(a.startsAt, b.startsAt) ||
        byIsoNullsLast(a.endsAt, b.endsAt) ||
        (a.tournamentName ?? '').localeCompare(b.tournamentName ?? ''),
    );
}

/** Start times of the user's own matches in this tournament, earliest first. */
export function competingStarts(tr: MyEventTournament, matches: ScheduleMatch[]): string[] {
  return matches
    .filter((m) => m.tournamentName === tr.name && m.scheduledAt)
    .map((m) => m.scheduledAt as string)
    .sort();
}

/** Earliest scheduled match start for the user in this tournament, else null. */
export function competingStart(tr: MyEventTournament, matches: ScheduleMatch[]): string | null {
  return competingStarts(tr, matches)[0] ?? null;
}

/**
 * The tournaments the user is registered in, ordered by their first match.
 * Tournaments with nothing scheduled sort last, alphabetically among themselves
 * — which is also the whole list's order before the schedule fetch resolves.
 */
export function buildCompetingRows(
  tournaments: MyEventTournament[],
  matches: ScheduleMatch[],
): MyEventTournament[] {
  return tournaments
    .filter((tr) => tr.registered)
    .map((tr) => ({ tr, start: competingStart(tr, matches) }))
    .sort((a, b) => byIsoNullsLast(a.start, b.start) || a.tr.name.localeCompare(b.tr.name))
    .map(({ tr }) => tr);
}
