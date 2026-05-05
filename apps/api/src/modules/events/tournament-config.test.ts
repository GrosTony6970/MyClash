import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import {
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

describe('tournament config validation', () => {
  it('normalizes display side colors with defaults', () => {
    expect(normalizeTournamentScoringConfig({}).display.sideColors).toEqual({
      red: 'red',
      blue: 'blue',
    });
  });

  it('accepts configured tournament side colors from the allowed palette', () => {
    const config = normalizeTournamentScoringConfig({
      ...DEFAULT_SCORING_CONFIG,
      display: { sideColors: { red: 'white', blue: 'black' } },
    });

    expect(config.display.sideColors).toEqual({ red: 'white', blue: 'black' });
  });

  it('rejects unsupported side colors', () => {
    expect(() =>
      normalizeTournamentScoringConfig({
        ...DEFAULT_SCORING_CONFIG,
        display: { sideColors: { red: 'cyan', blue: 'blue' } },
      }),
    ).toThrow(BadRequestException);
  });

  it('validates shared match-format ruleset config', () => {
    const config = validateTournamentRulesetConfig('TF_v1', {
      matchFormat: {
        pointCap: 7,
        scoringDirection: 'reverse_zero_loses',
        timerMode: 'countdown',
        timeLimitsSeconds: { pool: 90, bracket: 120, finals: 180 },
        softClockLimitSeconds: 5,
        maxDoubleHits: 3,
        maxDoubleHitOutcome: 'double_loss_zero_scores',
      },
    });

    expect(config.matchFormat.pointCap).toBe(7);
    expect(config.matchFormat.timeLimitsSeconds.finals).toBe(180);
  });

  it('rejects invalid match-format ruleset config', () => {
    expect(() =>
      validateTournamentRulesetConfig('TF_v1', {
        matchFormat: { pointCap: -1 },
      }),
    ).toThrow(BadRequestException);
  });
});
