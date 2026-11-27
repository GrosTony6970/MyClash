import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { correctionOutcome } from './correction-outcome';
import { scoredMatchFormat } from './scored-match-format';
import { MatchesService } from './matches.service';
import { builtInResolver } from './built-in-resolver.fixtures';
import {
  BOUT,
  hit,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * Venues scoring: a round is fought over N venues, and a clean hit wins one. The server prices
 * a hit at 1 per venue (`exchangeDeltas`), ends a bout on `venue_limit`, and closes a best-of
 * round the same way. See docs/superpowers/specs/2026-11-27-venue-scoring-design.md.
 */
const venuesFormat = (over: Record<string, unknown> = {}) => ({
  scoringUnit: 'venues',
  venuesPerRound: { pool: 3, bracket: 3, finals: 3 },
  stopWhenDecided: false,
  bestOf: { pool: 1, bracket: 1, finals: 1 },
  levelAtTime: {
    pool: [{ kind: 'draw' }],
    bracket: [{ kind: 'sudden_death' }],
    finals: [{ kind: 'sudden_death' }],
  },
  ...over,
});

const rulesOf = (matchFormat: Record<string, unknown>, code = 'TF_v1', version = '1.1.0') => ({
  ruleset_code: code,
  ruleset_version: version,
  ruleset_config: { matchFormat },
  scoring_config_json: {},
});

const inRound = (round: number, row: ReturnType<typeof hit>) => ({ ...row, round_number: round });

afterEach(() => vi.restoreAllMocks());

describe('ScoringService.recomputeMatchScore — a venues bout', () => {
  it('a single venues bout completes at its limit', async () => {
    const { service, written } = setup(
      storedBout({
        phases: { type: 'pool' },
        match_rules: rulesOf(venuesFormat()),
        match_number_label: 'L1-P1-M01',
        status: 'running',
        winner_registration_id: null,
        end_reason: null,
        red_score: 0,
        blue_score: 0,
      }),
      [hit(1, 'red', 2), hit(2, 'blue', 2), hit(3, 'red', 2)],
      RUNNING_EVENT,
    );

    await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({
      redScore: 2,
      blueScore: 1,
    });

    expect(written()?.row).toMatchObject({
      status: 'completed',
      end_reason: 'venue_limit',
      winner_registration_id: 'red',
      red_score: 2,
      blue_score: 1,
    });
  });

  it('a best-of venues round closes and the series completes', async () => {
    const format = venuesFormat({
      stopWhenDecided: true,
      bestOf: { pool: 3, bracket: 3, finals: 3 },
    });
    const bout = (over: Record<string, unknown>) =>
      storedBout({
        phases: { type: 'single_elim' },
        match_rules: rulesOf(format),
        match_number_label: 'QF1',
        status: 'running',
        winner_registration_id: null,
        end_reason: null,
        awaiting_round_advance: false,
        ...over,
      });
    const round1 = setup(
      bout({ current_round: 1, rounds_json: null, red_round_wins: 0, blue_round_wins: 0 }),
      [hit(1, 'red', 2), hit(2, 'red', 2)],
      RUNNING_EVENT,
    );

    await round1.service.recomputeMatchScore(BOUT);

    expect(round1.written()?.row).toMatchObject({
      awaiting_round_advance: true,
      red_round_wins: 1,
      rounds_json: [
        expect.objectContaining({ round: 1, winnerColor: 'red', endReason: 'venue_limit' }),
      ],
    });

    const closed = {
      round: 1,
      redScore: 2,
      blueScore: 0,
      winnerColor: 'red',
      endReason: 'venue_limit',
    };
    const round2 = setup(
      bout({ current_round: 2, rounds_json: [closed], red_round_wins: 1, blue_round_wins: 0 }),
      [
        hit(1, 'red', 2),
        hit(2, 'red', 2),
        inRound(2, hit(3, 'red', 2)),
        inRound(2, hit(4, 'red', 2)),
      ],
      RUNNING_EVENT,
    );

    await round2.service.recomputeMatchScore(BOUT);

    expect(round2.written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'red',
      end_reason: 'venue_limit',
    });
  });
});

describe('MatchesService.createExchange — what a venues hit stores', () => {
  function serviceFor(matchFormat: Record<string, unknown>, rules = rulesOf(matchFormat)) {
    const supabase = mockSupabase({
      match_events: { rows: [] },
      exchanges: [
        { data: null, error: null },
        { data: { id: 'ex-1' }, error: null },
      ],
      matches: {
        rows: [{ id: 'm1', current_round: 1, awaiting_round_advance: false, match_rules: rules }],
      },
    });
    const scoring = {
      recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
    };
    const service = new MatchesService(
      supabase as never,
      scoring as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      builtInResolver(),
    );
    return { supabase, service };
  }
  const post = (over: Record<string, unknown>) => ({
    clientUuid: 'uuid-1',
    sequence: 1,
    type: 'clean' as const,
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red' as const,
    ...over,
  });
  const stored = (supabase: ReturnType<typeof mockSupabase>) =>
    writesTo(supabase, 'exchanges')[0]?.row as Record<string, number>;

  it('the server prices a stale button as 1', async () => {
    // A pad that still had the 2-point button when the format turned to venues.
    const { service, supabase } = serviceFor(venuesFormat());

    await service.createExchange('m1', post({ firstStrikeValue: 2 }));

    expect(stored(supabase)).toMatchObject({
      first_strike_value: 2,
      red_score_delta: 1,
      blue_score_delta: 0,
    });
  });

  it('an afterblow posted in venues mode stores 0/0', async () => {
    const { service, supabase } = serviceFor(venuesFormat());

    await service.createExchange(
      'm1',
      post({ type: 'afterblow', firstStrikeValue: 2, afterblowValue: 1 }),
    );

    expect(stored(supabase)).toMatchObject({ red_score_delta: 0, blue_score_delta: 0 });
  });

  it('prices a clean hit by its button when the bout counts points', async () => {
    const { service, supabase } = serviceFor({ scoringUnit: 'points' });

    await service.createExchange('m1', post({ firstStrikeValue: 2 }));

    expect(stored(supabase)).toMatchObject({ red_score_delta: 2 });
  });

  it('prices in points a bout whose ruleset does not offer venues', async () => {
    const { service, supabase } = serviceFor(
      venuesFormat(),
      rulesOf(venuesFormat(), 'Generic_PointsCap', '1.0.0'),
    );

    await service.createExchange('m1', post({ firstStrikeValue: 2 }));

    expect(stored(supabase)).toMatchObject({ red_score_delta: 2 });
  });
});

describe('MatchesService.editExchange — what an edited venues hit stores', () => {
  function serviceFor(matchFormat: Record<string, unknown>) {
    const supabase = mockSupabase({
      exchanges: {
        rows: [{ id: 'ex-1', match_id: 'm1', voided: false, sequence: 3, round_number: 1 }],
        returning: { id: 'ex-2' },
      },
      matches: { rows: [{ id: 'm1', locked_at: null, match_rules: rulesOf(matchFormat) }] },
    });
    const scoring = {
      recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
      assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MatchesService(
      supabase as never,
      scoring as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      builtInResolver(),
    );
    return { supabase, service };
  }
  const edit = { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2, reason: 'wrong' };
  const replacement = (supabase: ReturnType<typeof mockSupabase>) =>
    writesTo(supabase, 'exchanges').find((write) => write.op === 'insert')?.row;

  it('prices the edited clean hit as 1, whatever its button', async () => {
    const { service, supabase } = serviceFor(venuesFormat());

    await service.editExchange('ex-1', edit as never);

    expect(replacement(supabase)).toMatchObject({
      first_strike_value: 2,
      red_score_delta: 1,
      blue_score_delta: 0,
    });
  });

  it('prices it by its button when the bout counts points', async () => {
    const { service, supabase } = serviceFor({ scoringUnit: 'points' });

    await service.editExchange('ex-1', edit as never);

    expect(replacement(supabase)).toMatchObject({ red_score_delta: 2, blue_score_delta: 0 });
  });
});

describe('MatchesService.getMatchSummary — the public bout page', () => {
  it('shows a points-cap bout whose copy says venues in points, as it is scored', async () => {
    const supabase = mockSupabase({
      vw_tournament_query_matches: {
        rows: [{ match_id: 'm1', status: 'running', tournament_id: 't1', event_id: 'event-1' }],
      },
      tournaments: { rows: [{ id: 't1', weapon: 'longsword' }] },
      events: { rows: [{ id: 'event-1', timezone: 'UTC' }] },
      matches: {
        rows: [
          {
            id: 'm1',
            lice_id: null,
            match_rules: rulesOf(venuesFormat({ pointCap: 7 }), 'Generic_PointsCap', '1.1.0'),
          },
        ],
      },
      referee_assignments: { rows: [] },
    });
    const service = new MatchesService(
      supabase as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      builtInResolver(),
    );

    const summary = await service.getMatchSummary('m1');

    expect(summary.matchFormat).toMatchObject({ scoringUnit: 'points', pointCap: 7 });
  });
});

describe('a voided venue', () => {
  it('re-decides the bout: a venue_limit end is decided on the board', () => {
    const outcome = correctionOutcome({
      bout: {
        status: 'completed',
        winnerRegistrationId: 'red',
        endReason: 'venue_limit',
        redRegistrationId: 'red',
        blueRegistrationId: 'blue',
        redScore: 2,
        blueScore: 1,
      },
      // A correction on an over Event leaves Blue ahead: the end was decided on the board.
      score: { redScore: 1, blueScore: 2 },
      engine: { isOver: false },
      staysFinished: true,
      laterBoutFought: false,
      drawAllowed: true,
    });

    expect(outcome.kind).toBe('redecide');
  });
});

describe('scoredMatchFormat — the scoring unit', () => {
  const stored = { matchFormat: { scoringUnit: 'venues' } };

  it('forces points for a ruleset that does not offer venues', async () => {
    const ruleset = await builtInResolver().resolve('Generic_PointsCap', '1.0.0');

    expect(scoredMatchFormat(stored, ruleset!).scoringUnit).toBe('points');
  });

  it('keeps the stored countdown when it forces points', async () => {
    const ruleset = await builtInResolver().resolve('Generic_PointsCap', '1.0.0');
    const countdown = {
      matchFormat: { scoringUnit: 'venues', scoringDirection: 'reverse_zero_loses' },
    };

    expect(scoredMatchFormat(countdown, ruleset!)).toMatchObject({
      scoringUnit: 'points',
      scoringDirection: 'reverse_zero_loses',
    });
  });

  it('counts a venues bout up, whatever direction it stores', async () => {
    const ruleset = await builtInResolver().resolve('TF_v1', '1.1.0');
    const countdown = {
      matchFormat: { scoringUnit: 'venues', scoringDirection: 'reverse_zero_loses' },
    };

    expect(scoredMatchFormat(countdown, ruleset!)).toMatchObject({
      scoringUnit: 'venues',
      scoringDirection: 'normal',
    });
  });

  it('keeps venues for a ruleset that offers them', async () => {
    const ruleset = await builtInResolver().resolve('TF_v1', '1.1.0');

    expect(scoredMatchFormat(stored, ruleset!).scoringUnit).toBe('venues');
  });
});
