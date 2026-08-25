/**
 * `maxDoubleHitOutcome` — what a bout stopped by the doubles ceiling COUNTS AS.
 *
 * Its own file because `match-format.test.ts` was exactly at the 400-line file
 * budget, and because this is one coherent surface: three outcomes, each
 * resolved into its own `matches.end_reason` so that every later reader of a
 * finished bout gets the answer off the row. Only `'max_doubles'` means loss
 * for both — see `maxDoubleHitEndReason`.
 */
import { describe, expect, it } from 'vitest';
import type { Exchange, Match } from './types';
import type { MatchFormatConfig } from './match-format';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  computeMatchFormatScore,
  endOnPointCapOrMaxDoubles,
  evaluateRound,
  MatchFormatConfigSchema,
} from './match-format';

const BASE_MATCH: Match = {
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'running',
};

function makeExchange(overrides: Partial<Exchange>): Exchange {
  return {
    id: overrides.id ?? 'ex-1',
    clientUuid: overrides.clientUuid ?? 'uuid-1',
    matchId: 'm1',
    sequence: overrides.sequence ?? 1,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    ...overrides,
  };
}

describe('maxDoubleHitOutcome', () => {
  const poolCfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 10, maxDoubleHits: 2 };
  const twoDoublesAndAHit = [
    makeExchange({ id: 'r1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
    makeExchange({ id: 'd1', sequence: 2, type: 'double', firstStrikerColor: null }),
    makeExchange({ id: 'd2', sequence: 3, type: 'double', firstStrikerColor: null }),
  ];
  const pool = { ...BASE_MATCH, phaseType: 'pool' as const };

  it('accepts all three values and still defaults to the double loss', () => {
    // The default has to hold: it is what every TF_v1 seed was written with,
    // and moving it would re-score every pool ever run under one.
    expect(MatchFormatConfigSchema.parse({}).maxDoubleHitOutcome).toBe('double_loss_zero_scores');
    for (const outcome of ['double_loss_zero_scores', 'draw_zero_scores', 'result_stands']) {
      expect(
        MatchFormatConfigSchema.parse({ maxDoubleHitOutcome: outcome }).maxDoubleHitOutcome,
      ).toBe(outcome);
    }
    expect(() => MatchFormatConfigSchema.parse({ maxDoubleHitOutcome: 'nope' })).toThrow();
  });

  it('wipes the board for both zeroing outcomes and keeps it for result_stands', () => {
    const zeroed = (outcome: 'double_loss_zero_scores' | 'draw_zero_scores') =>
      computeMatchFormatScore(pool, twoDoublesAndAHit, {
        ...poolCfg,
        maxDoubleHitOutcome: outcome,
      }).redScore;
    expect(zeroed('double_loss_zero_scores')).toBe(0);
    expect(zeroed('draw_zero_scores')).toBe(0);
    expect(
      computeMatchFormatScore(pool, twoDoublesAndAHit, {
        ...poolCfg,
        maxDoubleHitOutcome: 'result_stands',
      }).redScore,
    ).toBe(2);
  });

  it('resolves the outcome into the END REASON, one per value', () => {
    // This is the carrier. A reader of a finished bout — including a SQL
    // function and the cross-event fighter stats, neither of which can reach
    // the tournament config — gets the answer from `matches.end_reason`, and
    // only 'max_doubles' means loss for both.
    const reasonFor = (outcome: MatchFormatConfig['maxDoubleHitOutcome']) => {
      const config = { ...poolCfg, maxDoubleHitOutcome: outcome };
      return endOnPointCapOrMaxDoubles(
        pool,
        computeMatchFormatScore(pool, twoDoublesAndAHit, config),
        config,
      ).reason;
    };
    expect(reasonFor('double_loss_zero_scores')).toBe('max_doubles');
    expect(reasonFor('draw_zero_scores')).toBe('max_doubles_draw');
    expect(reasonFor('result_stands')).toBe('max_doubles_result_stands');
  });
});

describe('evaluateRound at the doubles ceiling', () => {
  const cfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 3 };

  /**
   * The doubles ceiling ENDS the bout either way; `maxDoubleHitOutcome` says
   * what the result IS. The outcome is resolved into the end reason here, so
   * every later reader of a finished bout has the answer on the row — only
   * `'max_doubles'` means loss for both.
   */
  it('draws a POOL round under draw_zero_scores, under its own reason', () => {
    const ev = evaluateRound(
      { ...BASE_MATCH, phaseType: 'pool' },
      [
        makeExchange({ id: 'r1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'd1', sequence: 2, type: 'double', firstStrikerColor: null }),
        makeExchange({ id: 'd2', sequence: 3, type: 'double', firstStrikerColor: null }),
      ],
      { ...cfg, maxDoubleHits: 2, maxDoubleHitOutcome: 'draw_zero_scores' as const },
    );
    expect(ev.autoOver).toBe(true);
    expect(ev.winnerColor).toBeNull();
    expect(ev.endReason).toBe('max_doubles_draw');
    // Still wiped: a draw at the ceiling is 0-0, like the double loss.
    expect(ev.score.redScore).toBe(0);
  });

  it('gives the POOL round to whoever leads under result_stands', () => {
    const ev = evaluateRound(
      { ...BASE_MATCH, phaseType: 'pool' },
      [
        makeExchange({ id: 'r1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'd1', sequence: 2, type: 'double', firstStrikerColor: null }),
        makeExchange({ id: 'd2', sequence: 3, type: 'double', firstStrikerColor: null }),
      ],
      { ...cfg, maxDoubleHits: 2, maxDoubleHitOutcome: 'result_stands' as const },
    );
    expect(ev.autoOver).toBe(true);
    expect(ev.winnerColor).toBe('red');
    expect(ev.endReason).toBe('max_doubles_result_stands');
    // The board is NOT wiped — that is the whole difference.
    expect(ev.score.redScore).toBe(2);
  });

  it('keeps a LEVEL result_stands round winner-less', () => {
    const ev = evaluateRound(
      { ...BASE_MATCH, phaseType: 'pool' },
      [
        makeExchange({ id: 'd1', sequence: 1, type: 'double', firstStrikerColor: null }),
        makeExchange({ id: 'd2', sequence: 2, type: 'double', firstStrikerColor: null }),
      ],
      { ...cfg, maxDoubleHits: 2, maxDoubleHitOutcome: 'result_stands' as const },
    );
    expect(ev.autoOver).toBe(true);
    expect(ev.winnerColor).toBeNull();
  });
});
