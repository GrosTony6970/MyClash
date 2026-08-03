/**
 * match-format-swiss.test.ts — how a Swiss bout resolves its clock, its
 * best-of and its max-doubles rule.
 *
 * Split out of `match-format.test.ts` to keep both files under the
 * complexity gate's 400-line file budget.
 */
import { describe, expect, it } from 'vitest';
import type { Exchange, Match } from './types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  computeMatchFormatScore,
  getEffectiveBestOf,
  getEffectiveMatchTimeLimitSeconds,
  getEffectiveMaxDoubles,
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

describe('Swiss match format', () => {
  it('applies max-doubles to Swiss rounds, like pools', () => {
    // Swiss is a group stage: nobody has to advance out of a single bout, so a
    // double loss (0 points each) is a result the standings can carry. Bracket
    // stays exempt because someone must come out of it.
    const exchanges = [
      makeExchange({ id: 'e0', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
      makeExchange({ id: 'e1', sequence: 2, type: 'double', firstStrikerColor: null }),
      makeExchange({ id: 'e2', sequence: 3, type: 'double', firstStrikerColor: null }),
    ];
    const cfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: 2 };

    expect(getEffectiveMaxDoubles({ ...BASE_MATCH, phaseType: 'swiss' }, cfg)).toBe(2);
    expect(getEffectiveMaxDoubles({ ...BASE_MATCH, phaseType: 'single_elim' }, cfg)).toBeNull();

    const swiss = computeMatchFormatScore({ ...BASE_MATCH, phaseType: 'swiss' }, exchanges, cfg);
    const pool = computeMatchFormatScore({ ...BASE_MATCH, phaseType: 'pool' }, exchanges, cfg);
    expect(swiss.redScore).toBe(pool.redScore);
    expect(swiss.blueScore).toBe(pool.blueScore);
  });

  it('falls back to the pool time limit and best-of when no swiss key is set', () => {
    // A ruleset config persisted before the Swiss format carries no swiss key
    // at all. It must resolve to the POOL clock, not the bracket one.
    const legacy = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timeLimitsSeconds: { pool: 90, bracket: 120, finals: 180 },
      bestOf: { pool: 1, bracket: 3, finals: 5 },
    };
    expect(getEffectiveMatchTimeLimitSeconds({ ...BASE_MATCH, phaseType: 'swiss' }, legacy)).toBe(
      90,
    );
    expect(getEffectiveBestOf({ ...BASE_MATCH, phaseType: 'swiss' }, legacy)).toBe(1);
  });

  it('prefers an explicit swiss time limit and best-of over the pool fallback', () => {
    const explicit = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timeLimitsSeconds: { pool: 90, swiss: 150, bracket: 120, finals: 180 },
      bestOf: { pool: 1, swiss: 3, bracket: 3, finals: 5 },
    };
    expect(getEffectiveMatchTimeLimitSeconds({ ...BASE_MATCH, phaseType: 'swiss' }, explicit)).toBe(
      150,
    );
    expect(getEffectiveBestOf({ ...BASE_MATCH, phaseType: 'swiss' }, explicit)).toBe(3);
  });

  it('keeps a stored swiss time limit through normalizeMatchFormatConfig', () => {
    // The schema strips unknown keys, so an un-declared `swiss` would be
    // dropped silently on every round-trip. Guard that it survives.
    const normalized = normalizeMatchFormatConfig({
      pointCap: 10,
      timeLimitsSeconds: { pool: 90, swiss: 150, bracket: 120, finals: 180 },
    });
    expect(normalized.timeLimitsSeconds.swiss).toBe(150);
  });
});
