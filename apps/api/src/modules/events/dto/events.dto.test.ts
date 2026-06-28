import { describe, expect, it } from 'vitest';
import { UpdateTournamentDto } from './events.dto';

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
