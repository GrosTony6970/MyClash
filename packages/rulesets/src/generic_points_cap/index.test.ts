import { describe, it, expect, beforeEach } from 'vitest';
import { Generic_PointsCap, GenericPointsCapDefaultConfig } from './index';
import { RulesetRegistry } from '../registry';
import type { Exchange, Match } from '../types';

const BASE_MATCH: Match = {
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'Generic_PointsCap',
  rulesetVersion: '1.0.0',
  status: 'running',
};

function makeEx(overrides: Partial<Exchange>): Exchange {
  return {
    id: 'e1',
    clientUuid: 'u1',
    matchId: 'm1',
    sequence: 1,
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

describe('Generic_PointsCap', () => {
  let registry: RulesetRegistry;
  beforeEach(() => {
    registry = new RulesetRegistry();
  });

  it('registers in the registry', () => {
    registry.register(Generic_PointsCap);
    expect(registry.has('Generic_PointsCap', '1.0.0')).toBe(true);
  });

  describe('computeMatchScore', () => {
    it('each hit scores 1 point (default hitValue=1)', () => {
      const exchanges = [
        makeEx({ id: 'e1', sequence: 1, firstStrikerColor: 'red' }),
        makeEx({ id: 'e2', sequence: 2, firstStrikerColor: 'red' }),
        makeEx({ id: 'e3', sequence: 3, firstStrikerColor: 'blue' }),
      ];
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, exchanges, {});
      expect(score.redScore).toBe(2);
      expect(score.blueScore).toBe(1);
    });

    it('afterblow counts as hit for first striker only', () => {
      const ex = makeEx({
        type: 'afterblow',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
        afterblowValue: 1,
      });
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, [ex], {});
      expect(score.redScore).toBe(1);
      expect(score.blueScore).toBe(0);
    });

    it('doubles do not score', () => {
      const ex = makeEx({ type: 'double', firstStrikerColor: null, firstStrikeValue: null });
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, [ex], {});
      expect(score.redScore).toBe(0);
      expect(score.blueScore).toBe(0);
      expect(score.doubles).toBe(1);
    });
  });

  describe('isMatchOver', () => {
    it('ends when red reaches pointsCap (default 10)', () => {
      const exchanges = Array.from({ length: 10 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'red' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, exchanges, 0, {});
      expect(result.isOver).toBe(true);
      expect(result.reason).toBe('first_to_points');
    });

    it('not over at 9 points (one short of the default pointsCap)', () => {
      const exchanges = Array.from({ length: 9 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'red' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, exchanges, 0, {});
      expect(result.isOver).toBe(false);
    });

    it('ends at time limit (90s default)', () => {
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, [], 90_000, {});
      expect(result.isOver).toBe(true);
      expect(result.reason).toBe('time_limit');
    });

    it('custom pointsCap=3 ends at 3 hits', () => {
      const config = { ...GenericPointsCapDefaultConfig, pointsCap: 3 };
      const exchanges = Array.from({ length: 3 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'blue' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, exchanges, 0, config);
      expect(result.isOver).toBe(true);
    });
  });

  describe('computePoolStandings', () => {
    it('ranks by wins first', () => {
      const regs = [
        { id: 'r1', seed: 1, bibNumber: null },
        { id: 'r2', seed: 2, bibNumber: null },
      ];
      const match = {
        id: 'm1',
        redRegistrationId: 'r1',
        blueRegistrationId: 'r2',
        rulesetCode: 'Generic_PointsCap',
        rulesetVersion: '1.0.0',
        status: 'completed' as const,
        winnerRegistrationId: 'r1',
        exchanges: [
          makeEx({ id: 'e1', sequence: 1, firstStrikerColor: 'red' }),
          makeEx({ id: 'e2', sequence: 2, firstStrikerColor: 'red' }),
          makeEx({ id: 'e3', sequence: 3, firstStrikerColor: 'red' }),
        ],
      };
      const rows = Generic_PointsCap.computePoolStandings(
        { id: 'pool-1', name: 'Pool A' },
        [match],
        regs,
        {},
      );
      expect(rows[0]?.registrationId).toBe('r1');
      expect(rows[0]?.wins).toBe(1);
      expect(rows[1]?.wins).toBe(0);
    });
  });
});
