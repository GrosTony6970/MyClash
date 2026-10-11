/**
 * The pad's view of a bout's rounds: which round is open, its score, the rounds
 * closed and by whom, and whether the series is decided.
 *
 * In a best-of bout the server counts by round: `matches.red_score` is the open
 * round's score, and the doubles limit is asked of the open round's doubles
 * (`recomputeBestOfRounds`). This is the ONE place the pad reads a round. A
 * single-round bout is the same function with one round.
 *
 * WITH NO NETWORK THE TABLET CLOSES A ROUND (operator, 2026-10-10). It predicts
 * with the score it shows and the server's own two rules (`roundOutcome`,
 * `seriesResult`); the server decides. A round the tablet closed is marked so
 * (`by: 'tablet'`), and the screen says "not confirmed".
 *
 * The tablet goes ahead of the server only while it holds something to send
 * and no row of the bout is refused. With an empty queue, or a row of the bout
 * held in the inbox, this gives the server's row and nothing else: that is
 * "the screen goes back to what the server says". The screen's own memory of
 * what it showed a moment ago is `pad-series-memory.ts`.
 *
 * Pure: no store, no React. The caller gives the rows.
 */
import {
  getEffectiveMaxDoubles,
  roundOutcome,
  seriesResult,
  type MatchFormatConfig,
  type PhaseType,
} from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { OutboxEntry } from './db';
import { provisionalDeltas } from './pending-events';

type Color = 'red' | 'blue';

/** One closed round, and who closed it. */
export interface PadRound {
  round: number;
  redScore: number;
  blueScore: number;
  /** Null for a round nobody won. */
  winnerColor: Color | null;
  /** `tablet`: the server has not confirmed it. */
  by: 'server' | 'tablet';
}

export interface PadSeries {
  /** The open round, or the closed one the bout stands on: 1 in a single-round bout. */
  round: number;
  /** The score of that round, as the pad counts it. */
  redScore: number;
  blueScore: number;
  /** The part of that score the tablet still holds: shown as provisional. */
  redQueued: number;
  blueQueued: number;
  /** The doubles of that round, the ones the tablet still holds included. */
  doubles: number;
  /** The doubles limit the server applies to this bout, or null for none. */
  doublesLimit: number | null;
  /** Every closed round, in order. */
  closed: PadRound[];
  redRoundWins: number;
  blueRoundWins: number;
  /** Round `round` is closed and the series goes on: "Start round N+1" is next. */
  awaitingStart: boolean;
  /** The series is over, and for whom (null: a drawn series). Null while it runs. */
  decided: { winnerColor: Color | null } | null;
  /** What says so: the server's row, or the tablet ahead of it (not confirmed). */
  by: 'server' | 'tablet';
}

/** The server's row of the bout, as far as the rounds read it. */
export interface ServerRounds {
  currentRound: number;
  awaitingRoundAdvance: boolean;
  /** The bout is completed or voided on the server: the tablet goes ahead of nothing. */
  over: boolean;
  /** `matches.rounds_json`: the closed rounds, as the server wrote them. */
  roundsJson: unknown;
  /** The open round's score (the closed one's at a round break). */
  redScore: number;
  blueScore: number;
}

export interface PadSeriesArgs {
  bestOf: number;
  phaseType: PhaseType | undefined;
  matchNumberLabel: string | null | undefined;
  matchFormat: MatchFormatConfig;
  server: ServerRounds;
  redRegistrationId: string;
  blueRegistrationId: string;
  /** The server's hits, not voided. Each carries its round (`round_number`). */
  exchanges: readonly ExchangeRow[];
  /** The hits and cards the tablet still holds, each with its round (`pendingRowsForMatch`). */
  queued: readonly ExchangeRow[];
  queuedPenalties: readonly Penalty[];
  /** The "Start round" and "End round" rows the tablet still holds, of this bout. */
  roundPresses: readonly OutboxEntry[];
  /** A row of this bout is held in the inbox: the server's row stands. */
  held: boolean;
}

const leader = (score: { redScore: number; blueScore: number }): Color | null =>
  score.redScore === score.blueScore ? null : score.redScore > score.blueScore ? 'red' : 'blue';

/** The server's closed rounds, read from `rounds_json`. A row that is no round is left out. */
function serverRounds(roundsJson: unknown): PadRound[] {
  if (!Array.isArray(roundsJson)) return [];
  const rounds: PadRound[] = [];
  for (const raw of roundsJson) {
    const row = raw as Partial<Record<'round' | 'redScore' | 'blueScore' | 'winnerColor', unknown>>;
    if (typeof row?.round !== 'number') continue;
    rounds.push({
      round: row.round,
      redScore: typeof row.redScore === 'number' ? row.redScore : 0,
      blueScore: typeof row.blueScore === 'number' ? row.blueScore : 0,
      winnerColor: row.winnerColor === 'red' || row.winnerColor === 'blue' ? row.winnerColor : null,
      by: 'server',
    });
  }
  return rounds.sort((a, b) => a.round - b.round);
}

/** The rounds a side won, of a list of closed rounds. */
export const roundsWon = (closed: readonly PadRound[], color: Color) =>
  closed.filter((round) => round.winnerColor === color).length;

/** The view a list of closed rounds gives, on the round the bout stands on. */
function standing(
  args: PadSeriesArgs,
  on: ReturnType<typeof roundCount>,
  closed: PadRound[],
  by: 'server' | 'tablet',
): PadSeries {
  const series = seriesResult(closed, args.bestOf);
  // The server's own word for "a round waits" on its view: a row of
  // `rounds_json` can lack (an old row), and a bout ended another way (a
  // forfeit at a round break) waits for no round.
  const roundClosed =
    by === 'server'
      ? args.server.awaitingRoundAdvance && !args.server.over
      : closed.some((round) => round.round === on.round);
  return {
    ...on,
    doublesLimit: getEffectiveMaxDoubles({ phaseType: args.phaseType }, args.matchFormat),
    closed,
    redRoundWins: roundsWon(closed, 'red'),
    blueRoundWins: roundsWon(closed, 'blue'),
    awaitingStart: roundClosed && !series.over,
    decided: series.over ? { winnerColor: series.winnerColor } : null,
    by,
  };
}

/** How one round counts on the pad: the server's part, plus what the tablet holds of it. */
function roundCount(args: PadSeriesArgs, round: number, serverRound: number) {
  // A queued row with no round, or with a round the server has passed, is
  // counted by the server in the round open when it arrives.
  const queuedIn = (row: { round_number?: number | null }) =>
    Math.max(row.round_number ?? serverRound, serverRound) === round;
  const queued = args.queued.filter(queuedIn);
  const added = provisionalDeltas({
    exchanges: queued,
    penalties: args.queuedPenalties.filter(queuedIn),
    redRegistrationId: args.redRegistrationId,
    blueRegistrationId: args.blueRegistrationId,
  });
  const base = round === serverRound ? args.server : { redScore: 0, blueScore: 0 };
  const double = (row: ExchangeRow) => row.type === 'double';
  // A server row with no round is of round 1: the server reads it so (`?? 1`).
  const serverDoubles = args.exchanges.filter(
    (row) => (row.round_number ?? 1) === round && double(row),
  ).length;
  return {
    round,
    redScore: base.redScore + added.red,
    blueScore: base.blueScore + added.blue,
    redQueued: added.red,
    blueQueued: added.blue,
    doubles: serverDoubles + queued.filter(double).length,
  };
}

/** A single-round bout: one round, never closed here. The clock ends the bout. */
function singleRound(args: PadSeriesArgs): PadSeries {
  const double = (row: ExchangeRow) => row.type === 'double';
  const added = provisionalDeltas({
    exchanges: args.queued,
    penalties: args.queuedPenalties,
    redRegistrationId: args.redRegistrationId,
    blueRegistrationId: args.blueRegistrationId,
  });
  const on = {
    round: 1,
    redScore: args.server.redScore + added.red,
    blueScore: args.server.blueScore + added.blue,
    redQueued: added.red,
    blueQueued: added.blue,
    doubles: args.exchanges.filter(double).length + args.queued.filter(double).length,
  };
  return {
    ...standing({ ...args, bestOf: 1 }, on, [], 'server'),
    awaitingStart: false,
    decided: null,
  };
}

/** A round the tablet moved past, or closed: by its "End round", or by its own score. */
function tabletRound(args: PadSeriesArgs, count: ReturnType<typeof roundCount>): PadRound {
  const end = args.roundPresses.find(
    (row) => row.roundAction === 'end' && row.round === count.round,
  );
  const score = end?.endScore
    ? { redScore: end.endScore.red, blueScore: end.endScore.blue }
    : { redScore: count.redScore, blueScore: count.blueScore };
  const outcome = roundOutcome(args, { ...score, doubles: count.doubles }, args.matchFormat);
  // "End round" gives the round to the leader. A round over by itself has the
  // winner its rule names: nobody, for a round the doubles limit wiped, and
  // the server then puts that round's board to 0-0.
  if (end || !outcome.autoOver) {
    return { round: count.round, ...score, winnerColor: leader(score), by: 'tablet' };
  }
  const wiped = outcome.endReason === 'max_doubles';
  const shown = wiped ? { redScore: 0, blueScore: 0 } : score;
  return { round: count.round, ...shown, winnerColor: outcome.winnerColor, by: 'tablet' };
}

/**
 * The server's own view: the tablet closes nothing and opens nothing. What it
 * holds is shown in the server's open round, whatever round it was tapped in:
 * the server counts a row in the round open when it arrives.
 */
function serverView(args: PadSeriesArgs, fromServer: PadRound[]): PadSeries {
  const unstamped = <T extends { round_number?: number | null }>(row: T): T => ({
    ...row,
    round_number: null,
  });
  const flat = {
    ...args,
    queued: args.queued.map(unstamped),
    queuedPenalties: args.queuedPenalties.map(unstamped),
  };
  const round = args.server.currentRound;
  return standing(args, roundCount(flat, round, round), fromServer, 'server');
}

export function padSeries(args: PadSeriesArgs): PadSeries {
  if (args.bestOf <= 1) return singleRound(args);

  const { server } = args;
  const fromServer = serverRounds(server.roundsJson);
  const waits = args.queued.length + args.queuedPenalties.length + args.roundPresses.length > 0;
  // Under reverse scoring (a round starts at the cap and counts down) the pad's
  // sum is not the server's score, so the tablet predicts nothing there: it
  // closes no round and opens none before the server does.
  const predicts = args.matchFormat.scoringDirection !== 'reverse_zero_loses';
  if (args.held || !waits || !predicts || server.over) {
    return serverView(args, fromServer);
  }

  const stamps = [...args.queued, ...args.queuedPenalties].map((row) => row.round_number ?? 0);
  const advances = args.roundPresses
    .filter((row) => row.roundAction === 'advance')
    .map((row) => row.round ?? 0);
  const open = Math.max(server.currentRound, ...stamps, ...advances);

  const closed = [...fromServer];
  const known = (round: number) => closed.some((row) => row.round === round);
  // The rounds the tablet moved past, which the server's row does not hold yet.
  for (let round = server.currentRound; round < open; round += 1) {
    if (!known(round)) closed.push(tabletRound(args, roundCount(args, round, server.currentRound)));
  }

  const count = roundCount(args, open, server.currentRound);
  const ended = args.roundPresses.some((row) => row.roundAction === 'end' && row.round === open);
  const over = roundOutcome(args, count, args.matchFormat).autoOver;
  if (!known(open) && (ended || over)) closed.push(tabletRound(args, count));

  const stoodOn = closed.find((row) => row.round === open);
  const on = stoodOn
    ? { ...count, redScore: stoodOn.redScore, blueScore: stoodOn.blueScore }
    : count;
  const ahead = open > server.currentRound || closed.some((row) => row.by === 'tablet');
  return standing(args, on, closed, ahead ? 'tablet' : 'server');
}
