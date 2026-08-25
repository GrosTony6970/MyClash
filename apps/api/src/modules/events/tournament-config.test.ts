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

  it('accepts a level-at-time chain from the organiser surfaces', () => {
    // The match-format schema is `.strict()`, so a key the editor sends and
    // this does not list 400s the whole PATCH — the failure mode the Advanced
    // tab hit for months. This is that check for the chain.
    const config = validateTournamentRulesetConfig('TF_v1', {
      matchFormat: {
        levelAtTime: {
          pool: [{ kind: 'draw' }],
          bracket: [{ kind: 'extra_time', seconds: 60 }, { kind: 'sudden_death' }],
          finals: [{ kind: 'sudden_death' }],
        },
      },
    });

    // `finals` is asserted because it is the one that does NOT match the
    // default. Asserting only `bracket` passed while `normalizeMatchFormatConfig`
    // was dropping the whole key: a config carrying only modern keys fell down
    // the legacy branch, which rebuilds from three named legacy fields and
    // discards everything else. The PATCH answered 200 with nothing saved.
    expect(config.matchFormat.levelAtTime.finals).toEqual([{ kind: 'sudden_death' }]);
    expect(config.matchFormat.levelAtTime.bracket).toEqual([
      { kind: 'extra_time', seconds: 60 },
      { kind: 'sudden_death' },
    ]);
  });

  it('rejects a level-at-time chain that ends in extra time', () => {
    // A chain ending in extra time describes a bout that can come back level
    // for ever, so the referee reaches the end of it and still cannot finish
    // the bout. Refused here, in the organiser's own request.
    expect(() =>
      validateTournamentRulesetConfig('TF_v1', {
        matchFormat: { levelAtTime: { bracket: [{ kind: 'extra_time', seconds: 60 }] } },
      }),
    ).toThrow(BadRequestException);
  });
});

import { defaultRulesetConfigFor, normalizeRulesetVersion } from './ruleset-defaults';

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

describe('ruleset-switch reset behavior', () => {
  it('Generic_PointsCap defaults do not include TF_v1-only keys', () => {
    const next = defaultRulesetConfigFor('Generic_PointsCap', '1');
    // Generic_PointsCap shouldn't have winBonus or targetValues (TF_v1 internals).
    expect(next).not.toHaveProperty('winBonus');
    expect(next).not.toHaveProperty('targetValues');
  });

  it('TF_v1 defaults include expected keys', () => {
    const next = defaultRulesetConfigFor('TF_v1', '1');
    expect(next).toHaveProperty('winBonus');
    expect(next).toHaveProperty('targetValues');
  });
});

describe('normalizeRulesetVersion', () => {
  it('maps "1" and "1.0" to canonical "1.0.0"', () => {
    expect(normalizeRulesetVersion('1')).toBe('1.0.0');
    expect(normalizeRulesetVersion('1.0')).toBe('1.0.0');
    expect(normalizeRulesetVersion('1.0.0')).toBe('1.0.0');
    expect(normalizeRulesetVersion('2.0.0')).toBe('2.0.0');
  });
});
