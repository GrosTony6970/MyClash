import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateTournamentDto } from './events.dto';

/**
 * Regression guard for the tournament creation wizard. Step 2 of the
 * wizard PATCHes /api/v1/tournaments/:id with rulesetConfig.matchFormat
 * populated. Before this fix the global ValidationPipe (configured with
 * forbidNonWhitelisted: true) rejected the request with a 400 because
 * matchFormat was not declared on TournamentRulesetConfigDto.
 *
 * Tests cover:
 *   - The exact payload the wizard sends → passes validation.
 *   - An unknown nested field (e.g. `bogus`) → still rejected, so we
 *     keep the whitelist hygiene we expect from forbidNonWhitelisted.
 */
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

  it('accepts the exact payload the step-2 wizard sends', async () => {
    const dto = plainToInstance(UpdateTournamentDto, wizardPayload);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });

  it('accepts a partially-populated matchFormat (every field optional)', async () => {
    const dto = plainToInstance(UpdateTournamentDto, {
      rulesetConfig: { matchFormat: { pointCap: 7 } },
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects an unknown field nested inside rulesetConfig (whitelist guard)', async () => {
    const dto = plainToInstance(UpdateTournamentDto, {
      rulesetConfig: { matchFormat: { pointCap: 5 }, bogus: 'x' },
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    // The error array contains a nested child error pointing at the unknown
    // property — exact shape varies across class-validator versions, so we
    // just assert at least one error surfaced.
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range pointCap (sanity check on the new decorators)', async () => {
    const dto = plainToInstance(UpdateTournamentDto, {
      rulesetConfig: { matchFormat: { pointCap: 999 } },
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
