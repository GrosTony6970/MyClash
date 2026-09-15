import type { ProgrammePhase, SuggestConfig, TournamentLengths } from '@myclash/types';

/**
 * How long a bout of a given kind lasts, read from the Event's planner sheet.
 *
 * ADR-018: the sheet is the one place an organiser types a bout length. A
 * Tournament may carry its own lengths on the same sheet; a blank one reads the
 * Event's. A Swiss bout with no Swiss length of its own takes the pool length,
 * at each level. So the order for a Swiss bout is: the Tournament's Swiss
 * length, the Tournament's pool length, the Event's Swiss length, the Event's
 * pool length.
 *
 * Pure: the caller loads the sheet. Suggest, Generate and the re-fan call it;
 * every reader of a Match's window follows in a later slice.
 */
export type MatchKind = 'pool' | 'swiss' | 'elimination' | 'finals';

/**
 * A bracket's final round: the highest round among the Matches that EXIST, or
 * null when none resolves.
 *
 * Matches, not bracket slots. A double-elimination reset slot is generated one
 * round past the grand final and has no Match until it is needed; a max over
 * slots would call the grand final "elimination" while Suggest and Generate
 * put it in the finals bar.
 */
export function finalRoundOf(rounds: ReadonlyArray<number | null>): number | null {
  const known = rounds.filter((round): round is number => round != null);
  return known.length > 0 ? Math.max(...known) : null;
}

/**
 * A bracket Match is a finals bout when it sits in the final round: the gold
 * final and the bronze, or the grand final and its reset. A Match whose round
 * does not resolve is not.
 */
export function isFinalsMatch(round: number | null, finalRound: number | null): boolean {
  return round != null && finalRound != null && round === finalRound;
}

/**
 * The kind of bout a Match is, from its phase type (`pool`, `swiss`,
 * `single_elim`, `double_elim`) and, for a bracket, its round against the
 * bracket's final round.
 */
export function matchKind(
  phaseType: string | null,
  round: number | null,
  finalRound: number | null,
): MatchKind {
  if (phaseType === 'pool') return 'pool';
  if (phaseType === 'swiss') return 'swiss';
  return isFinalsMatch(round, finalRound) ? 'finals' : 'elimination';
}

/** The kind of bout a programme bar schedules. A bracket bar holds elimination bouts. */
export function barKind(phase: ProgrammePhase): MatchKind {
  return phase === 'bracket' ? 'elimination' : phase;
}

export function sheetLengthFor(
  kind: MatchKind,
  sheet: SuggestConfig,
  tournamentId: string,
): number {
  const row = sheet.tournaments.find((r) => r.tournamentId === tournamentId);
  const own = row === undefined ? undefined : tournamentLength(kind, row);
  return own ?? eventLength(kind, sheet);
}

/** A Tournament's own number for the kind, or undefined when its box is blank. */
function tournamentLength(kind: MatchKind, row: TournamentLengths): number | undefined {
  switch (kind) {
    case 'pool':
      return row.poolMatchDurationMinutes;
    case 'swiss':
      return row.swissMatchDurationMinutes ?? row.poolMatchDurationMinutes;
    case 'elimination':
      return row.eliminationMatchDurationMinutes;
    case 'finals':
      return row.finalsMatchDurationMinutes;
  }
}

/** The Event's number for the kind. Only the Swiss length may be blank. */
function eventLength(kind: MatchKind, sheet: SuggestConfig): number {
  switch (kind) {
    case 'pool':
      return sheet.poolMatchDurationMinutes;
    case 'swiss':
      return sheet.swissMatchDurationMinutes ?? sheet.poolMatchDurationMinutes;
    case 'elimination':
      return sheet.eliminationMatchDurationMinutes;
    case 'finals':
      return sheet.finalsMatchDurationMinutes;
  }
}
