import { describe, it, expect, beforeEach } from 'vitest';
import { Generic_PointsCap, GenericPointsCapDefaultConfig } from './index';
import { RulesetRegistry } from '../registry';
import type { Exchange, Match, ScoredMatch } from '../types';
import { applyRanking } from '@myclash/rules/results';

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
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, exchanges, 'full', {});
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
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, [ex], 'full', {});
      expect(score.redScore).toBe(1);
      expect(score.blueScore).toBe(0);
    });

    it('doubles do not score', () => {
      const ex = makeEx({ type: 'double', firstStrikerColor: null, firstStrikeValue: null });
      const score = Generic_PointsCap.computeMatchScore(BASE_MATCH, [ex], 'full', {});
      expect(score.redScore).toBe(0);
      expect(score.blueScore).toBe(0);
      expect(score.doubles).toBe(1);
    });
  });

  describe('isMatchOver', () => {
    /** The score the caller would hold, from this bout's exchanges. */
    const scoreOf = (exchanges: Exchange[], config: unknown) =>
      Generic_PointsCap.computeMatchScore(BASE_MATCH, exchanges, 'full', config);

    it('ends when red reaches pointsCap (default 10)', () => {
      const exchanges = Array.from({ length: 10 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'red' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, scoreOf(exchanges, {}), {});
      expect(result.isOver).toBe(true);
      expect(result.reason).toBe('first_to_points');
    });

    it('not over at 9 points (one short of the default pointsCap)', () => {
      const exchanges = Array.from({ length: 9 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'red' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, scoreOf(exchanges, {}), {});
      expect(result.isOver).toBe(false);
    });

    // The 'ends at time limit (90s default)' case went with the branch it
    // covered: nothing passes a clock any more, and ClockService ends a bout
    // that runs out of time.

    it('custom pointsCap=3 ends at 3 hits', () => {
      const config = { ...GenericPointsCapDefaultConfig, pointsCap: 3 };
      const exchanges = Array.from({ length: 3 }, (_, i) =>
        makeEx({ id: `e${i}`, sequence: i + 1, firstStrikerColor: 'blue' }),
      );
      const result = Generic_PointsCap.isMatchOver(BASE_MATCH, scoreOf(exchanges, config), config);
      expect(result.isOver).toBe(true);
    });
  });

  describe('scorePoolFighters', () => {
    const bout: ScoredMatch = {
      id: 'm1',
      redRegistrationId: 'r1',
      blueRegistrationId: 'r2',
      winnerRegistrationId: 'r1',
      exchanges: [
        makeEx({ id: 'e1', sequence: 1, firstStrikerColor: 'red' }),
        makeEx({ id: 'e2', sequence: 2, firstStrikerColor: 'red' }),
        makeEx({ id: 'e3', sequence: 3, firstStrikerColor: 'red' }),
      ],
    };

    const scores = () =>
      Generic_PointsCap.scorePoolFighters({
        registrationIds: ['r1', 'r2'],
        completedMatches: [bout],
        afterblowMode: 'full',
        config: {},
      });

    it('puts a win a thousand ahead, so wins outrank any differential', () => {
      // r1 won 3-0: 1 * 1000 + 3. r2 lost: 0 * 1000 - 3.
      expect(scores().get('r1')).toBe(1003);
      expect(scores().get('r2')).toBe(-3);
    });

    it('returns a score for a fighter who fought nothing', () => {
      // A fighter with no bouts must still appear, or the standings table drops
      // a row rather than showing a zero.
      const withBye = Generic_PointsCap.scorePoolFighters({
        registrationIds: ['r1', 'r2', 'r3'],
        completedMatches: [bout],
        afterblowMode: 'full',
        config: {},
      });
      expect(withBye.get('r3')).toBe(0);
    });

    it('orders by the declared chain, which is the only sorter left', () => {
      // The ruleset used to sort its own rows; the API discarded that ordering
      // and re-ranked with applyRanking over the rendered columns. Only the
      // second one ever decided a placement.
      const rows = [
        { id: 'r2', W: 0, diff: -3 },
        { id: 'r1', W: 1, diff: 3 },
      ].map((r) => ({
        rank: 0,
        registrationId: r.id,
        displayName: r.id,
        club: null,
        status: 'completed' as const,
        stats: { W: r.W, diff: r.diff, ptsScored: 0 },
      }));
      expect(
        applyRanking(rows, Generic_PointsCap.rankingChain).map((r) => r.registrationId),
      ).toEqual(['r1', 'r2']);
    });
  });
});
