import { describe, expect, it } from 'vitest';
import { CreateTournamentDto, UpdateTournamentDto } from './events.dto';

/**
 * Regression guard for the tournament creation wizard. Step 2 PATCHes
 * /api/v1/tournaments/:id with rulesetConfig.matchFormat populated; nested
 * `.strict()` keeps the forbidNonWhitelisted hygiene (unknown nested fields
 * rejected), and the numeric bounds are enforced.
 */
const schema = UpdateTournamentDto.schema;

describe('UpdateTournamentDto — rulesetConfig.matchFormat', () => {
  const wizardPayload = {
    rulesetConfig: {
      matchFormat: {
        pointCap: 5,
        scoringDirection: 'normal',
        timerMode: 'countdown',
        timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
        softClockLimitSeconds: 60,
        maxDoubleHits: 3,
      },
    },
    scoringConfig: { afterblowMode: 'full' },
  };

  it('accepts the exact payload the step-2 wizard sends', () => {
    expect(schema.safeParse(wizardPayload).success).toBe(true);
  });

  it('accepts a partially-populated matchFormat', () => {
    expect(schema.safeParse({ rulesetConfig: { matchFormat: { pointCap: 7 } } }).success).toBe(
      true,
    );
  });

  it('rejects an unknown field nested inside rulesetConfig (strict)', () => {
    expect(
      schema.safeParse({ rulesetConfig: { matchFormat: { pointCap: 5 }, bogus: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range pointCap', () => {
    expect(schema.safeParse({ rulesetConfig: { matchFormat: { pointCap: 999 } } }).success).toBe(
      false,
    );
  });

  it('accepts a per-phase best-of (odd values)', () => {
    expect(
      schema.safeParse({
        rulesetConfig: { matchFormat: { bestOf: { pool: 1, bracket: 3, finals: 5 } } },
      }).success,
    ).toBe(true);
  });

  it('rejects an even best-of value', () => {
    expect(
      schema.safeParse({ rulesetConfig: { matchFormat: { bestOf: { bracket: 2 } } } }).success,
    ).toBe(false);
  });

  it('rejects an unknown key inside bestOf (strict)', () => {
    expect(
      schema.safeParse({ rulesetConfig: { matchFormat: { bestOf: { semis: 3 } } } }).success,
    ).toBe(false);
  });

  /**
   * "0 = no limit" is what both organiser surfaces promise, and until this
   * transform it was a promise nothing could keep: the PATCH was accepted here
   * and then rejected by the engine's `.positive()` with "Too small: expected
   * number to be >0", so the organiser did what the help text said and got
   * engine-speak in a toast.
   */
  describe('a time limit of zero means NO limit', () => {
    const parsedLimits = (
      timeLimitsSeconds: Record<string, number | null>,
    ): Record<string, unknown> => {
      const parsed = schema.parse({ rulesetConfig: { matchFormat: { timeLimitsSeconds } } });
      return (
        parsed.rulesetConfig as { matchFormat: { timeLimitsSeconds: Record<string, unknown> } }
      ).matchFormat.timeLimitsSeconds;
    };

    it('turns a zero into the null the engine understands', () => {
      expect(parsedLimits({ pool: 0, bracket: 240, finals: 300 })).toEqual({
        pool: null,
        bracket: 240,
        finals: 300,
      });
    });

    it('leaves every real limit alone, on every phase', () => {
      // The mirror, so the case above cannot pass on a schema that nulls
      // everything — which would silently un-time a whole tournament.
      expect(parsedLimits({ pool: 180, bracket: 0, finals: 0 })).toEqual({
        pool: 180,
        bracket: null,
        finals: null,
      });
    });

    it('keeps an explicit null a null', () => {
      expect(parsedLimits({ pool: null, bracket: 90, finals: 90 })['pool']).toBeNull();
    });
  });
});

describe('UpdateTournamentDto — logoUrl', () => {
  it('accepts a string logoUrl', () => {
    expect(schema.safeParse({ logoUrl: 'https://cdn.test/x/logo.png' }).success).toBe(true);
  });

  it('accepts null logoUrl', () => {
    expect(schema.safeParse({ logoUrl: null }).success).toBe(true);
  });

  it('rejects a non-string logoUrl', () => {
    expect(schema.safeParse({ logoUrl: 12345 }).success).toBe(false);
  });
});

describe("the forfeit rule's Off (ruling 52): a null removes it, on a save only", () => {
  const off = { rulesetConfig: { tournamentPolicy: { disqualifyAfter: null } } };

  it('a save accepts it', () => {
    expect(schema.safeParse(off).success).toBe(true);
  });

  it('a create refuses it: there is no setting to remove', () => {
    const create = { name: 'Sabre', slug: 'sabre', ...off };
    expect(CreateTournamentDto.schema.safeParse(create).success).toBe(false);
  });

  it('a save still refuses a key the policy does not have, and a count out of bounds', () => {
    const policy = (p: Record<string, unknown>) => ({ rulesetConfig: { tournamentPolicy: p } });
    expect(schema.safeParse(policy({ disqualifyAfter: 2, bogus: true })).success).toBe(false);
    expect(schema.safeParse(policy({ disqualifyAfter: 11 })).success).toBe(false);
    expect(schema.safeParse({ rulesetConfig: { bogus: 1 } }).success).toBe(false);
  });
});
