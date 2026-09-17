import { hullMs, matchWindowMs } from '@myclash/schedule-core';
import type { SuggestConfig, TournamentLengths } from '@myclash/types';

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
 * Pure: the caller loads the sheet. Suggest and Generate call `sheetLengthFor`
 * with a sheet they already hold; every other reader asks `resolveMatchLengths`
 * (`match-lengths.ts`), which calls it per Match.
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

/** One bracket Match's phase and round, as `finalRoundsByPhase` needs them. */
export interface BracketRoundRow {
  phase_id: string;
  round: number | null;
}

/**
 * The final round of EACH bracket phase.
 *
 * Per phase, not per Tournament. A Tournament may hold more than one bracket —
 * a main draw and a repechage — and their rounds are numbered independently, so
 * one number over the pair would call one bracket's final an ordinary
 * elimination bout and give it the wrong length. A phase with no readable round
 * maps to null, which `isFinalsMatch` refuses.
 */
export function finalRoundsByPhase(rows: readonly BracketRoundRow[]): Map<string, number | null> {
  const byPhase = new Map<string, Array<number | null>>();
  for (const row of rows) {
    const rounds = byPhase.get(row.phase_id);
    if (rounds) rounds.push(row.round);
    else byPhase.set(row.phase_id, [row.round]);
  }
  return new Map([...byPhase].map(([phaseId, rounds]) => [phaseId, finalRoundOf(rounds)]));
}

/**
 * A Match's planned length from the map `resolveMatchLengths` returns, or a
 * throw.
 *
 * The helper answers for every id it was asked about, so a miss means the
 * caller looked up a Match it never resolved. Every reader used to fill that
 * gap with a guess — five minutes, mostly — and a guessed length is how a
 * referee was reported free while they fought. There is no default to fall
 * back to on purpose.
 */
export function plannedLengthOf(lengths: ReadonlyMap<string, number>, matchId: string): number {
  const minutes = lengths.get(matchId);
  if (minutes === undefined) throw new Error(`No planned length for match ${matchId}`);
  return minutes;
}

/**
 * When a run of bouts — a Pool, a Swiss round on a piste, a Tournament — is
 * planned to finish: the END of the hull of its placed bouts' windows
 * (ADR-017), each as long as its planned length. The latest end, which is not
 * the last start's end when a longer bout sits earlier.
 *
 * A bout with no time is ignored; a run with none placed has no end (null).
 */
export function plannedEndIso(
  bouts: ReadonlyArray<{ scheduledAt: string | null; durationMinutes: number }>,
): string | null {
  const hull = hullMs(
    bouts.flatMap((bout) =>
      bout.scheduledAt === null ? [] : [matchWindowMs(bout.scheduledAt, bout.durationMinutes)],
    ),
  );
  return hull ? new Date(hull.endMs).toISOString() : null;
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

/**
 * The rest break a Pool of this Tournament takes in the middle of each piste's
 * queue, in minutes (ADR-018). Zero is no break.
 *
 * Same shape as `sheetLengthFor`: the Tournament's own number when its box has
 * one, the Event's otherwise. A Tournament box left blank reads the Event's; a
 * Tournament box holding 0 says this Tournament takes no break even where the
 * Event does, which is why absent and zero cannot be folded together.
 */
export function sheetRestFor(sheet: SuggestConfig, tournamentId: string): number {
  const row = sheet.tournaments.find((r) => r.tournamentId === tournamentId);
  return row?.minRestMinutes ?? sheet.minRestMinutes;
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
