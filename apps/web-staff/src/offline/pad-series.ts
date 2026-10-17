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
  applyScoringDirection,
  belowZero,
  getEffectiveMaxDoubles,
  roundOutcome,
  seriesResult,
  type MatchFormatConfig,
  type PhaseType,
  EDITION_2026_10,
} from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { OutboxEntry } from './db';
import { countsDown, serverScore } from './pad-server-score';
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
  /**
   * "End round" closed it, on the server: a cancelled entry moves its score
   * and the round stays closed. A round the engine closed by itself goes back
   * in play when its sheet no longer ends it.
   */
  onTime?: true;
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
  /**
   * In a bout that counts down: how far under zero each side went (the board
   * stops at zero). With both at zero, the fighter less far below has won.
   */
  redBelowZero?: number;
  blueBelowZero?: number;
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
  /** The server's cards, not voided, each with its round. Its row's score holds their points. */
  penalties: readonly Penalty[];
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
    const row = raw as Partial<
      Record<'round' | 'redScore' | 'blueScore' | 'winnerColor' | 'endReason', unknown>
    >;
    if (typeof row?.round !== 'number') continue;
    // The server's own test of "closed by the official" (`roundShouldReopen`).
    const onTime = row.endReason == null || row.endReason === 'time_limit';
    rounds.push({
      round: row.round,
      redScore: typeof row.redScore === 'number' ? row.redScore : 0,
      blueScore: typeof row.blueScore === 'number' ? row.blueScore : 0,
      winnerColor: row.winnerColor === 'red' || row.winnerColor === 'blue' ? row.winnerColor : null,
      by: 'server',
      ...(onTime ? { onTime: true as const } : {}),
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

/**
 * A round's score on the pad: the server's part plus what the tablet holds.
 * The ONE place the pad adds a queued hit or card to a score.
 *
 * It adds in EARNED points and turns them into the score with the server's own
 * function (`applyScoringDirection`): in a bout that counts down a hit takes
 * its points off the OPPONENT, and a side stops at zero. A card's points land
 * after that, on the carded fighter's own side (`recomputeMatchScore`), so the
 * server's cards of the round are taken out before the turn and put back
 * after. In a bout that counts up this is the server's score plus the queue.
 *
 * `base` is null for a round the server has not scored: nobody has earned
 * anything in it. A card of that round the server's list already holds counts
 * (the list of cards can land before the bout's row).
 */
function scoreOnPad(
  args: PadSeriesArgs,
  base: Pick<ServerRounds, 'redScore' | 'blueScore'> | null,
  rows: {
    serverCards: readonly Penalty[];
    queued: readonly ExchangeRow[];
    queuedCards: readonly Penalty[];
  },
) {
  const { redRegistrationId, blueRegistrationId, matchFormat } = args;
  const sum = (exchanges: readonly ExchangeRow[], penalties: readonly Penalty[]) =>
    provisionalDeltas({ exchanges, penalties, redRegistrationId, blueRegistrationId });
  const carded = sum([], rows.serverCards);
  const hits = sum(rows.queued, []);
  const cards = sum([], rows.queuedCards);

  // What each side has earned on the server, read back from its row.
  const part = base
    ? { red: base.redScore - carded.red, blue: base.blueScore - carded.blue }
    : { red: 0, blue: 0 };
  const earned =
    base && countsDown(args)
      ? { red: matchFormat.pointCap - part.blue, blue: matchFormat.pointCap - part.red }
      : part;
  const scored = (plus: { red: number; blue: number }) => {
    const score = applyScoringDirection(
      matchFormat,
      earned.red + plus.red,
      earned.blue + plus.blue,
    );
    return { red: score.redScore + carded.red, blue: score.blueScore + carded.blue };
  };
  const sent = scored({ red: 0, blue: 0 });
  const withHits = scored(hits);
  const redScore = withHits.red + cards.red;
  const blueScore = withHits.blue + cards.blue;
  return {
    redScore,
    blueScore,
    redQueued: redScore - sent.red,
    blueQueued: blueScore - sent.blue,
    // A bout that counts down stops at zero: how far under each side went, for
    // the rule of both at zero. Known limit: of a side the SERVER's row already
    // holds at zero, the tablet knows only what its own unsent hits add.
    ...belowZero(matchFormat, earned.red + hits.red, earned.blue + hits.blue),
  };
}

/** How one round counts on the pad: the server's part, plus what the tablet holds of it. */
function roundCount(args: PadSeriesArgs, round: number, serverRound: number) {
  // A queued row with no round, or with a round the server has passed, is
  // counted by the server in the round open when it arrives.
  const queuedIn = (row: { round_number?: number | null }) =>
    Math.max(row.round_number ?? serverRound, serverRound) === round;
  const queued = args.queued.filter(queuedIn);
  // A server row with no round is of round 1: the server reads it so (`?? 1`).
  const ofRound = (row: { round_number?: number | null }) => (row.round_number ?? 1) === round;
  const double = (row: ExchangeRow) => row.type === 'double';
  const serverDoubles = args.exchanges.filter((row) => ofRound(row) && double(row)).length;
  return {
    round,
    // A round the tablet opened itself is one the server has not scored.
    ...scoreOnPad(args, round === serverRound ? serverScore(args) : null, {
      serverCards: args.penalties.filter(ofRound),
      queued,
      queuedCards: args.queuedPenalties.filter(queuedIn),
    }),
    doubles: serverDoubles + queued.filter(double).length,
  };
}

/** A single-round bout: one round, never closed here. The clock ends the bout. */
function singleRound(args: PadSeriesArgs): PadSeries {
  const double = (row: ExchangeRow) => row.type === 'double';
  const on = {
    round: 1,
    ...scoreOnPad(args, serverScore(args), {
      serverCards: args.penalties,
      queued: args.queued,
      queuedCards: args.queuedPenalties,
    }),
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
  // A round over by itself is judged on the whole count: with both at zero in
  // a bout that counts down, how far under each side went names the winner.
  const outcome = roundOutcome(args, count, args.matchFormat, EDITION_2026_10);
  // "End round" gives the round to the leader, or to the fighter the cap had
  // given it to at the tap (`pressedOn`). A round over by itself has the
  // winner its rule names: nobody, for a round the doubles limit wiped, and
  // the server then puts that round's board to 0-0.
  if (end || !outcome.autoOver) {
    const winnerColor = end?.endScore?.winner ?? leader(score);
    return { round: count.round, ...score, winnerColor, by: 'tablet' };
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
  if (args.held || !waits || server.over) {
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
  const over = roundOutcome(args, count, args.matchFormat, EDITION_2026_10).autoOver;
  if (!known(open) && (ended || over)) closed.push(tabletRound(args, count));

  const stoodOn = closed.find((row) => row.round === open);
  const on = stoodOn
    ? { ...count, redScore: stoodOn.redScore, blueScore: stoodOn.blueScore }
    : count;
  const ahead = open > server.currentRound || closed.some((row) => row.by === 'tablet');
  return standing(args, on, closed, ahead ? 'tablet' : 'server');
}
