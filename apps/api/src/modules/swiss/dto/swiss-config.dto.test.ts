import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWISS_POINTS,
  DEFAULT_SWISS_TIEBREAK_CHAIN,
  parseSwissConfig,
  swissConfigSchema,
  type SwissConfig,
} from './swiss-config.dto';

const base: SwissConfig = {
  roundCount: 5,
  seedingStrategy: 'random',
  pairingMethod: 'fold',
  grouping: { kind: 'points' },
  rankBy: 'swissPts',
  points: { ...DEFAULT_SWISS_POINTS },
  tiebreakChain: [...DEFAULT_SWISS_TIEBREAK_CHAIN],
};

const parse = (over: Record<string, unknown> = {}) =>
  swissConfigSchema.safeParse({ ...base, ...over });

describe('swissConfigSchema', () => {
  it('accepts the default configuration', () => {
    expect(parse().success).toBe(true);
  });

  it('holds roundCount to the 3..9 the engine clamps to', () => {
    expect(parse({ roundCount: 3 }).success).toBe(true);
    expect(parse({ roundCount: 9 }).success).toBe(true);
    // Under 3 the standings have separated nobody; over 9 is not a one-day event.
    expect(parse({ roundCount: 2 }).success).toBe(false);
    expect(parse({ roundCount: 10 }).success).toBe(false);
    expect(parse({ roundCount: 4.5 }).success).toBe(false);
  });

  it('rejects unknown keys rather than silently dropping them', () => {
    // .strict() matters here: a typo'd key that parsed would leave the engine
    // running on the default while the organiser believes they changed it.
    expect(parse({ pairingMehtod: 'adjacent' }).success).toBe(false);
  });

  describe('by-pool-rank needs a source phase', () => {
    it('refuses rather than falling back to registration order', () => {
      const result = parse({ seedingStrategy: 'by-pool-rank' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['sourcePhaseId']);
    });

    it('accepts it once a source phase is named', () => {
      expect(
        parse({
          seedingStrategy: 'by-pool-rank',
          sourcePhaseId: '00000000-0000-4000-8000-000000000001',
        }).success,
      ).toBe(true);
    });

    it('does not require one for random or by-rating', () => {
      expect(parse({ seedingStrategy: 'random' }).success).toBe(true);
      expect(parse({ seedingStrategy: 'by-rating' }).success).toBe(true);
    });
  });

  describe('score bands', () => {
    const bands = (boundaries: number[]) => parse({ grouping: { kind: 'scoreBands', boundaries } });

    it('accepts a strictly ascending list', () => {
      expect(bands([0.2, 0.4, 0.6, 0.8]).success).toBe(true);
    });

    it('rejects unsorted or duplicated boundaries', () => {
      expect(bands([0.4, 0.2]).success).toBe(false);
      expect(bands([0.2, 0.2]).success).toBe(false);
    });

    it('requires at least one boundary and caps the list at ten', () => {
      // Zero boundaries is one band, i.e. no grouping at all — use points.
      expect(bands([]).success).toBe(false);
      expect(bands(Array.from({ length: 10 }, (_, i) => i)).success).toBe(true);
      expect(bands(Array.from({ length: 11 }, (_, i) => i)).success).toBe(false);
    });

    it('does not accept boundaries on the points variant', () => {
      expect(parse({ grouping: { kind: 'points', boundaries: [0.5] } }).success).toBe(false);
    });
  });

  describe('tiebreak chain', () => {
    it('accepts only whitelisted keys', () => {
      expect(parse({ tiebreakChain: ['buchholz', 'headToHead', 'score'] }).success).toBe(true);
      // An unknown key would rank every fighter on 0 rather than erroring,
      // because applyRanking reads Number(row.stats[key] ?? 0).
      expect(parse({ tiebreakChain: ['buchholzz'] }).success).toBe(false);
    });

    it('rejects a repeated key, whose second appearance is unreachable', () => {
      const result = parse({ tiebreakChain: ['buchholz', 'score', 'buchholz'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('buchholz');
    });

    it('accepts an empty chain — the primary key alone decides', () => {
      expect(parse({ tiebreakChain: [] }).success).toBe(true);
    });

    it('accepts the rulesetChain sentinel anywhere in the order', () => {
      expect(parse({ tiebreakChain: ['rulesetChain', 'buchholz'] }).success).toBe(true);
    });
  });

  it('allows negative and zero point values — a ruleset may penalise a loss', () => {
    expect(parse({ points: { win: 3, draw: 1, loss: -1, bye: 3 } }).success).toBe(true);
    expect(parse({ points: { win: 1, draw: 0, loss: 0, bye: 1 } }).success).toBe(true);
  });

  it('takes null for the clearable optionals, not just undefined', () => {
    // The FE clears a field by sending null; .optional() alone would reject it.
    expect(
      parse({ seedingRandomSeed: null, sourcePhaseId: null, minRatingCoveragePercent: null })
        .success,
    ).toBe(true);
  });

  it('bounds the rating-coverage threshold to a percentage', () => {
    expect(parse({ minRatingCoveragePercent: 0 }).success).toBe(true);
    expect(parse({ minRatingCoveragePercent: 100 }).success).toBe(true);
    expect(parse({ minRatingCoveragePercent: 101 }).success).toBe(false);
    expect(parse({ minRatingCoveragePercent: -1 }).success).toBe(false);
  });
});

describe('parseSwissConfig', () => {
  it('returns the config for a valid blob', () => {
    expect(parseSwissConfig(base)?.roundCount).toBe(5);
  });

  it('returns null rather than throwing on a malformed blob', () => {
    // A read path renders "misconfigured" instead of 500-ing the whole page.
    expect(parseSwissConfig(null)).toBeNull();
    expect(parseSwissConfig({})).toBeNull();
    expect(parseSwissConfig({ ...base, roundCount: 99 })).toBeNull();
    expect(parseSwissConfig('not an object')).toBeNull();
  });
});
