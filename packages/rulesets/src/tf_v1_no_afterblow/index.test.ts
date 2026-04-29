import { describe, it, expect, beforeEach } from 'vitest';
import { TF_v1_no_afterblow } from './index';
import { TF_v1 } from '../tf_v1/index';
import { registry } from '../registry';
import type { Exchange, Match } from '../types';

const BASE_MATCH: Match = {
  id: 'm1', redRegistrationId: 'reg-red', blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1_no_afterblow', rulesetVersion: '1.0.0', status: 'running',
};

function makeEx(overrides: Partial<Exchange>): Exchange {
  return {
    id: 'e1', clientUuid: 'u1', matchId: 'm1', sequence: 1,
    type: 'clean', occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red', firstStrikeValue: 1,
    afterblowValue: null, noExchangeReason: null, voided: false,
    ...overrides,
  };
}

describe('TF_v1_no_afterblow', () => {
  beforeEach(() => registry.clear());

  it('registers in the registry', () => {
    registry.register(TF_v1_no_afterblow);
    expect(registry.has('TF_v1_no_afterblow', '1.0.0')).toBe(true);
  });

  describe('computeMatchScore', () => {
    it('clean hit scores normally', () => {
      const ex = makeEx({ type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 });
      const score = TF_v1_no_afterblow.computeMatchScore(BASE_MATCH, [ex], {});
      expect(score.redScore).toBe(2);
      expect(score.blueScore).toBe(0);
    });

    it('afterblow: only first striker scores (afterblow value ignored)', () => {
      const ex = makeEx({
        type: 'afterblow',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
        afterblowValue: 1,
      });
      const score = TF_v1_no_afterblow.computeMatchScore(BASE_MATCH, [ex], {});
      // Red struck first → red gets 1pt
      expect(score.redScore).toBe(1);
      // Blue's afterblow is IGNORED
      expect(score.blueScore).toBe(0);
    });

    it('differs from TF_v1 on afterblow exchanges', () => {
      const ex = makeEx({
        type: 'afterblow',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
        afterblowValue: 1,
      });
      const tfv1Score = TF_v1.computeMatchScore(BASE_MATCH, [ex], {});
      const noAfterblowScore = TF_v1_no_afterblow.computeMatchScore(BASE_MATCH, [ex], {});
      // TF_v1: blue gets afterblow_value=1
      expect(tfv1Score.blueScore).toBe(1);
      // TF_v1_no_afterblow: blue gets 0
      expect(noAfterblowScore.blueScore).toBe(0);
    });
  });

  describe('isMatchOver', () => {
    it('ends at time limit', () => {
      const result = TF_v1_no_afterblow.isMatchOver(BASE_MATCH, [], 180_000, {});
      expect(result.isOver).toBe(true);
      expect(result.reason).toBe('time_limit');
    });
  });

  describe('computePoolStandings', () => {
    it('returns one row per registration', () => {
      const regs = [
        { id: 'r1', seed: 1, bibNumber: null },
        { id: 'r2', seed: 2, bibNumber: null },
      ];
      const rows = TF_v1_no_afterblow.computePoolStandings(
        { id: 'pool-1', name: 'Pool A' },
        [],
        regs,
        {},
      );
      expect(rows).toHaveLength(2);
    });
  });
});
