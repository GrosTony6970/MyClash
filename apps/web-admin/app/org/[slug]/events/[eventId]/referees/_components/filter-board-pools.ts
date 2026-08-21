import { zonedDay } from '@myclash/time';

/**
 * The day + tournament filter behind the referee workspace's Assignments tab.
 *
 * Lifted out of the page component so the predicates are reachable by a test.
 * Everything here is pure: no React, no fetch, no clock — the caller supplies
 * the event timezone and the units, and gets a plain answer back.
 *
 * "Unit" in this file means one card on the timeline. It is usually a Pool but
 * may be a bracket match, a finals card, or a Swiss round on one piste — the
 * board schedules all four (`AssignmentBoardPool.kind`), and none of the
 * filtering below cares which it is.
 */

/** The shape these predicates need. The board's pool type is a superset. */
export interface FilterableUnit {
  tournamentId: string;
  tournamentName: string;
  /** A real UTC instant, or null for a unit nobody has scheduled yet. */
  scheduledStart: string | null;
}

export interface TournamentOption {
  id: string;
  name: string;
}

export interface UnitFilter {
  /** null = every day, which is the only view unscheduled units appear in. */
  dayIso: string | null;
  /** The clock the day is measured on. Never the browser's. */
  tz: string;
  /** Tournaments to keep. Empty keeps nothing — that is a real, reachable state. */
  tournamentIds: readonly string[];
}

/** Inclusive list of YYYY-MM-DD between two ISO dates, as plain date strings. */
function eachDayIso(startIso: string | null, endIso: string | null): string[] {
  if (!startIso) return [];
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = endIso ? new Date(`${endIso}T00:00:00.000Z`) : start;
  if (Number.isNaN(start.getTime()) || end.getTime() < start.getTime()) return [startIso];
  const days: string[] = [];
  for (const d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The days the filter offers: the event's own span UNION the days units are
 * really scheduled on.
 *
 * The union is the point. The span comes from the event record and the units
 * come from the assignment board, and the two disagree in practice — a unit
 * dragged outside the event's dates used to be reachable only under "All
 * days", because no chip could ever match it.
 */
export function eventDayIsosFor(
  startDate: string | null,
  endDate: string | null,
  units: readonly FilterableUnit[],
  tz: string,
): string[] {
  const days = new Set(eachDayIso(startDate, endDate));
  for (const unit of units) {
    const day = zonedDay(unit.scheduledStart, tz);
    if (day) days.add(day);
  }
  return [...days].sort();
}

/**
 * The tournaments that have at least one unit on `dayIso` (or anywhere in the
 * event when it is null), ordered by when they first run, then by name so two
 * tournaments starting together keep a stable order.
 */
export function tournamentsForDay(
  units: readonly FilterableUnit[],
  dayIso: string | null,
  tz: string,
): TournamentOption[] {
  const firstStartById = new Map<string, { name: string; startMs: number }>();
  for (const unit of units) {
    if (dayIso !== null && zonedDay(unit.scheduledStart, tz) !== dayIso) continue;
    // An unscheduled unit sorts last rather than being dropped: its tournament
    // still has something on the board that needs referees.
    const startMs = unit.scheduledStart
      ? new Date(unit.scheduledStart).getTime()
      : Number.POSITIVE_INFINITY;
    const seen = firstStartById.get(unit.tournamentId);
    if (!seen || startMs < seen.startMs) {
      firstStartById.set(unit.tournamentId, { name: unit.tournamentName, startMs });
    }
  }
  return [...firstStartById.entries()]
    .sort(([, a], [, b]) => a.startMs - b.startMs || a.name.localeCompare(b.name))
    .map(([id, { name }]) => ({ id, name }));
}

/** Day first, then tournament. Both predicates have to pass. */
export function filterBoardPools<T extends FilterableUnit>(
  units: readonly T[],
  { dayIso, tz, tournamentIds }: UnitFilter,
): T[] {
  const keep = new Set(tournamentIds);
  return units.filter((unit) => {
    if (dayIso !== null && zonedDay(unit.scheduledStart, tz) !== dayIso) return false;
    return keep.has(unit.tournamentId);
  });
}

/**
 * Whether the "All" chip is lit. True only when every tournament on offer is
 * selected, so the chip is unlit exactly when clicking it would change
 * something.
 */
export function allTournamentsSelected(
  tournaments: readonly TournamentOption[],
  selectedIds: readonly string[],
): boolean {
  if (tournaments.length === 0) return true;
  const selected = new Set(selectedIds);
  return tournaments.every((t) => selected.has(t.id));
}
