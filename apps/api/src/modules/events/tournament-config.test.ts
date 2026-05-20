import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import {
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';
import { deepMergeJson } from '../../common/deep-merge';

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

// Contract test: documents the merge semantics that updateTournament relies on.
// The service-level integration (that updateTournament actually invokes deepMergeJson
// in the right order) is covered by the existing PATCH integration tests.
describe('deepMergeJson contract as it applies to updateTournament nested-config patches', () => {
  it('PATCH with { rulesetConfig: { winBonus: 5 } } preserves other rulesetConfig keys', () => {
    const stored = { winBonus: 3, targetValues: { deepTarget: 2, shallowTarget: 1 } };
    const patch = { winBonus: 5 };
    const merged = deepMergeJson(stored, patch);
    expect(merged).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 2, shallowTarget: 1 },
    });
  });

  it('PATCH with { scoringConfig: { pointCap: 7 } } preserves stored buttons array', () => {
    const stored = { pointCap: 5, buttons: { clean: [{ label: 'A' }] } };
    const patch = { pointCap: 7 };
    const merged = deepMergeJson(stored, patch);
    expect(merged).toEqual({
      pointCap: 7,
      buttons: { clean: [{ label: 'A' }] },
    });
  });
});
