/**
 * A best-of-3 Pool bout, first to 5, with a doubles limit of 3, as the pad's
 * round view reads it: the server's row, the server's hits, and what the tablet
 * still holds.
 */
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { OutboxEntry } from './db';
import type { PadSeriesArgs, ServerRounds } from './pad-series';

export const FORMAT: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 5,
  maxDoubleHits: 3,
};

let next = 1;

/** A hit of the server's list, in the shape `GET /matches/:id/exchanges` gives. */
export function row(type: ExchangeRow['type'], round?: number | null): ExchangeRow {
  const id = `x${next++}`;
  return {
    id,
    client_uuid: id,
    sequence: next,
    type,
    voided: false,
    occurredAt: '2026-10-10T10:00:00.000Z',
    ...(round === undefined ? {} : { round_number: round }),
  };
}

/** A hit the tablet still holds: `points` to `side`, in `round` (none: the tablet does not know). */
export function hit(side: 'red' | 'blue', points: number, round?: number): ExchangeRow {
  return {
    ...row('clean', round),
    scoringSide: side,
    scoreDelta: points,
    defenderDelta: null,
    pending: true,
  };
}

/** A double the tablet still holds. */
export const double = (round?: number): ExchangeRow => ({ ...row('double', round), pending: true });

/** A card the tablet still holds, that takes `points` off red. */
export function cardAgainstRed(points: number, round?: number): Penalty {
  return {
    id: `c${next++}`,
    registration_id: 'red',
    card: 'red',
    source: 'direct',
    score_delta: -points,
    causes_match_forfeit: false,
    voided: false,
    pending: true,
    ...(round === undefined ? {} : { round_number: round }),
  } as Penalty;
}

/** A queued "Start round `round`". */
export const start = (round: number): OutboxEntry => roundRow('advance', round);

/** A queued "End round `round`", pressed on `red`-`blue`. */
export const end = (round: number, red: number, blue: number): OutboxEntry => ({
  ...roundRow('end', round),
  endScore: { red, blue },
});

function roundRow(roundAction: 'advance' | 'end', round: number): OutboxEntry {
  return {
    kind: 'round',
    roundAction,
    round,
    clientUuid: `r${next++}`,
    matchId: 'm1',
    sequence: 0,
    occurredAt: '2026-10-10T10:00:00.000Z',
    createdAt: 0,
    attempts: 0,
  };
}

/** The server's row: round 1 open at 0-0, nothing closed. */
export const ROUND_1: ServerRounds = {
  currentRound: 1,
  awaitingRoundAdvance: false,
  over: false,
  roundsJson: [],
  redScore: 0,
  blueScore: 0,
};

/** A closed round as the server writes it in `rounds_json`. */
export const closedRound = (round: number, red: number, blue: number) => ({
  round,
  redScore: red,
  blueScore: blue,
  winnerColor: red === blue ? null : red > blue ? 'red' : 'blue',
  endReason: 'first_to_points',
});

/** The bout, with what a test changes of it. */
export function bout(over: Partial<PadSeriesArgs> = {}): PadSeriesArgs {
  return {
    bestOf: 3,
    phaseType: 'pool',
    matchNumberLabel: 'L1-P1-M1',
    matchFormat: FORMAT,
    server: ROUND_1,
    redRegistrationId: 'red',
    blueRegistrationId: 'blue',
    exchanges: [],
    penalties: [],
    queued: [],
    queuedPenalties: [],
    roundPresses: [],
    held: false,
    ...over,
  };
}
