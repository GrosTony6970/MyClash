import { describe, expect, it } from 'vitest';
import type { Exchange, Match } from './types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  computeMatchClockMs,
  computeMatchFormatScore,
  getEffectiveMatchTimeLimitSeconds,
  isMedalMatch,
  getPointCapWinnerRegistrationId,
  isSoftClockLocked,
  normalizeMatchFormatConfig,
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

describe('match format config', () => {
  it('exposes federal-rulebook defaults (pointCap=10, 90s time limits, 5s soft-clock, maxDoubleHits=4)', () => {
    // These are the global baseline for any ruleset that doesn't override
    // its match-format blob. Bumping these is a deliberate behavior change
    // requested by the operator — every fresh tournament inherits them.
    expect(DEFAULT_MATCH_FORMAT_CONFIG.pointCap).toBe(10);
    expect(DEFAULT_MATCH_FORMAT_CONFIG.timeLimitsSeconds.pool).toBe(90);
    expect(DEFAULT_MATCH_FORMAT_CONFIG.timeLimitsSeconds.bracket).toBe(90);
    expect(DEFAULT_MATCH_FORMAT_CONFIG.timeLimitsSeconds.finals).toBe(90);
    expect(DEFAULT_MATCH_FORMAT_CONFIG.softClockLimitSeconds).toBe(5);
    expect(DEFAULT_MATCH_FORMAT_CONFIG.maxDoubleHits).toBe(4);
  });

  it('normalizes legacy TF_v1 matchFormat config into shared match format', () => {
    const config = normalizeMatchFormatConfig({
      firstToPoints: 7,
      timeLimitSeconds: 120,
      maxDoubles: 4,
    });

    expect(config.pointCap).toBe(7);
    expect(config.timeLimitsSeconds.pool).toBe(120);
    expect(config.timeLimitsSeconds.bracket).toBe(120);
    expect(config.timeLimitsSeconds.finals).toBe(120);
    expect(config.maxDoubleHits).toBe(4);
  });

  it('computes normal first-to-cap scores from exchange points', () => {
    const score = computeMatchFormatScore(
      BASE_MATCH,
      [makeExchange({ firstStrikerColor: 'red', firstStrikeValue: 2 })],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5, scoringDirection: 'normal' },
    );

    expect(score.redScore).toBe(2);
    expect(score.blueScore).toBe(0);
  });

  it('computes reverse scoring as depletion where reaching zero loses', () => {
    const score = computeMatchFormatScore(
      BASE_MATCH,
      [
        makeExchange({ id: 'e1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'e2', sequence: 2, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'e3', sequence: 3, firstStrikerColor: 'red', firstStrikeValue: 1 }),
      ],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5, scoringDirection: 'reverse_zero_loses' },
    );

    expect(score.redScore).toBe(5);
    expect(score.blueScore).toBe(0);
  });

  it('resets result scores to zero when the configured double-hit limit is reached', () => {
    const score = computeMatchFormatScore(
      BASE_MATCH,
      [
        makeExchange({ id: 'e1', sequence: 1, type: 'double', firstStrikerColor: null }),
        makeExchange({ id: 'e2', sequence: 2, type: 'double', firstStrikerColor: null }),
      ],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: 2 },
    );

    expect(score.redScore).toBe(0);
    expect(score.blueScore).toBe(0);
    expect(score.doubles).toBe(2);
  });

  it('uses pool, bracket, and medal-match final time limits', () => {
    const config = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timeLimitsSeconds: { pool: 90, bracket: 120, finals: 180 },
    };

    expect(getEffectiveMatchTimeLimitSeconds({ ...BASE_MATCH, phaseType: 'pool' }, config)).toBe(
      90,
    );
    expect(
      getEffectiveMatchTimeLimitSeconds(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: 'QF1' },
        config,
      ),
    ).toBe(120);
    expect(
      getEffectiveMatchTimeLimitSeconds(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: '3rd' },
        config,
      ),
    ).toBe(180);
    expect(isMedalMatch({ ...BASE_MATCH, matchNumberLabel: 'F' })).toBe(true);
  });

  it('detects soft clock lockout for stopped countdown clocks under the configured limit', () => {
    const config = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timerMode: 'countdown' as const,
      timeLimitsSeconds: { pool: 180, bracket: 180, finals: 180 },
      softClockLimitSeconds: 5,
    };

    expect(isSoftClockLocked({ ...BASE_MATCH, phaseType: 'pool' }, 176_000, false, config)).toBe(
      true,
    );
    expect(isSoftClockLocked({ ...BASE_MATCH, phaseType: 'pool' }, 176_000, true, config)).toBe(
      false,
    );
    expect(computeMatchClockMs({ ...BASE_MATCH, phaseType: 'pool' }, 176_000, config)).toBe(4_000);
  });

  it('resolves point-cap winners for normal and reverse scoring', () => {
    expect(
      getPointCapWinnerRegistrationId(
        BASE_MATCH,
        { redScore: 5, blueScore: 3 },
        {
          ...DEFAULT_MATCH_FORMAT_CONFIG,
          pointCap: 5,
          scoringDirection: 'normal',
        },
      ),
    ).toBe('reg-red');

    expect(
      getPointCapWinnerRegistrationId(
        BASE_MATCH,
        { redScore: 2, blueScore: 0 },
        {
          ...DEFAULT_MATCH_FORMAT_CONFIG,
          pointCap: 5,
          scoringDirection: 'reverse_zero_loses',
        },
      ),
    ).toBe('reg-red');
  });
});
