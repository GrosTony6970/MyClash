import { vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';

/**
 * One finished bout and the services around it, for the two files that test
 * what a correction does to it: `scoring.service.corrections.test.ts` (the
 * recompute) and `scoring.service.preflight.test.ts` (the question a door asks
 * before it writes).
 */
export const BOUT = 'm1';

/** A clean hit, as the `exchanges` table holds it. */
export function hit(seq: number, color: 'red' | 'blue', value: number) {
  return {
    id: `e${seq}`,
    match_id: BOUT,
    sequence: seq,
    type: 'clean',
    occurred_at: '2026-01-01T00:00:00Z',
    first_striker_color: color,
    first_strike_value: value,
    afterblow_value: null,
    no_exchange_reason: null,
    round_number: 1,
    voided: false,
  };
}

/** A Pool that may end level, a bracket that may not; first to 7. */
export const phase = (type: 'pool' | 'single_elim') => ({
  type,
  tournaments: {
    ruleset_config: {
      matchFormat: {
        pointCap: 7,
        bestOf: { pool: 1, bracket: 1, finals: 1 },
        levelAtTime: {
          pool: [{ kind: 'draw' }],
          bracket: [{ kind: 'sudden_death' }],
          finals: [{ kind: 'sudden_death' }],
        },
      },
    },
    scoring_config_json: null,
  },
});

/** Red won 5-4 when the time ran out. The sheet below says what it reads NOW. */
export function storedBout(over: Record<string, unknown> = {}) {
  return {
    id: BOUT,
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    ruleset_code: 'TF_v1',
    ruleset_version: '1.0.0',
    status: 'completed',
    winner_registration_id: 'red',
    end_reason: 'time_limit',
    red_score: 5,
    blue_score: 4,
    match_number_label: 'P1M1',
    current_round: 1,
    rounds_json: null,
    phases: phase('pool'),
    ...over,
  };
}

export const OVER_EVENT = { eventOver: true, staysFinished: true, laterBoutFought: false };
export const RUNNING_EVENT = { eventOver: false, staysFinished: false, laterBoutFought: false };

/** The League re-score, recording what the bracket had been told when it was asked (ruling 248). */
function leagueDouble(completion: {
  onResultChanged: { mock: { calls: unknown[] } };
  onMatchCompleted: { mock: { calls: unknown[] } };
}) {
  const bracketToldBeforeLeagues: number[] = [];
  const leagueRescore = {
    afterResultWrite: vi.fn(async (_matchId: string) => {
      bracketToldBeforeLeagues.push(
        completion.onResultChanged.mock.calls.length +
          completion.onMatchCompleted.mock.calls.length,
      );
    }),
  };
  return { leagueRescore, bracketToldBeforeLeagues };
}

export function setup(
  bout: Record<string, unknown>,
  sheet: Array<Record<string, unknown>>,
  context: Record<string, boolean> = OVER_EVENT,
  cards: Array<Record<string, unknown>> = [],
  records: Array<Record<string, unknown>> = [],
) {
  const db = mockSupabase({
    // A second bout: unscoped, the reads and the write would take it too.
    matches: { rows: [bout, storedBout({ id: 'm2' })] },
    exchanges: { rows: [...sheet, { ...hit(9, 'red', 3), match_id: 'm2' }] },
    match_penalties: { rows: cards },
    // The second bout's record is live: it holds nothing of the first (ruling 322).
    match_forfeits: { rows: [...records, { id: 'f2', match_id: 'm2', voided_at: null }] },
  });
  const writesWhenToldTheBracket: number[] = [];
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    resultChangeContext: vi.fn().mockResolvedValue(context),
    onResultChanged: vi.fn(async () => {
      writesWhenToldTheBracket.push(writesTo(db, 'matches').length);
    }),
  };
  const clock = {
    getClockState: vi.fn().mockResolvedValue({ levelResolutionSteps: 0, status: 'ended' }),
  };
  const { leagueRescore, bracketToldBeforeLeagues } = leagueDouble(matchCompletion);
  const service = new ScoringService(
    db as never,
    { resolve: vi.fn().mockResolvedValue(null) } as never,
    clock as never,
    matchCompletion as never,
    leagueRescore as never,
  );
  const written = () => writesTo(db, 'matches')[0];
  return {
    db,
    clock,
    matchCompletion,
    leagueRescore,
    bracketToldBeforeLeagues,
    service,
    written,
    writesWhenToldTheBracket,
  };
}
