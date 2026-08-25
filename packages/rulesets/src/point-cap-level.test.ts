/**
 * Reaching the point cap with NOBODY ahead.
 *
 * Both fighters can cross the cap on the SAME exchange: at 9-9 a 1-1 afterblow
 * in `full` mode makes it 10-10. The bout then completed with a null winner and
 * `end_reason: 'first_to_points'`, and a bracket round with a null winner never
 * advances — the stalled round the level-at-time chain exists to close, reached
 * by one afterblow and with no clock action to refuse.
 *
 * So the chain decides here too, from its CONTENT rather than its position:
 * a phase that can end level does, a phase that cannot keeps the bout open.
 */
import { describe, expect, it } from 'vitest';
import type { Match, MatchScore } from './types';
import type { MatchFormatConfig } from './match-format';
import { Generic_PointsCap } from './index';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  endOnPointCapOrMaxDoubles,
  pointCapEndsBout,
  pointCapWinnerColor,
} from './match-format';

const CONFIG: MatchFormatConfig = { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 10 };

const score = (redScore: number, blueScore: number): MatchScore => ({
  redScore,
  blueScore,
  redWins: 0,
  blueWins: 0,
  redTargetPoints: 0,
  blueTargetPoints: 0,
  redTimesHit: 0,
  blueTimesHit: 0,
  doubles: 0,
});

const POOL = { phaseType: 'pool' as const, matchNumberLabel: 'L1-P1-M01' };
const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };

describe('pointCapEndsBout', () => {
  it('keeps a level bracket bout OPEN at the cap', () => {
    // 9-9 plus a 1-1 afterblow. Nobody has won, and this phase's chain has no
    // `draw` step, so the bout stays open and sudden death runs on.
    expect(pointCapEndsBout(BRACKET, score(10, 10), CONFIG)).toBe(false);
  });

  it('still ends a level POOL bout at the cap', () => {
    // The pool chain IS a draw, so 10-10 there is a finished bout — unchanged.
    expect(pointCapEndsBout(POOL, score(10, 10), CONFIG)).toBe(true);
  });

  it('ends any bout where someone leads at the cap', () => {
    expect(pointCapEndsBout(BRACKET, score(10, 3), CONFIG)).toBe(true);
    // BOTH over the cap with a leader — the exchange after a 10-10 that kept the
    // bout open. It must finish, or sudden death has no exit.
    expect(pointCapEndsBout(BRACKET, score(12, 10), CONFIG)).toBe(true);
  });

  it('is not reached below the cap', () => {
    expect(pointCapEndsBout(BRACKET, score(9, 9), CONFIG)).toBe(false);
    expect(pointCapEndsBout(POOL, score(9, 9), CONFIG)).toBe(false);
  });

  it('follows a bracket configured to allow a draw', () => {
    // The rule reads the chain, not the phase name.
    const drawable: MatchFormatConfig = {
      ...CONFIG,
      levelAtTime: { ...CONFIG.levelAtTime, bracket: [{ kind: 'draw' }] },
    };
    expect(pointCapEndsBout(BRACKET, score(10, 10), drawable)).toBe(true);
  });
});

describe('pointCapWinnerColor with both sides at the cap', () => {
  it('names the leader rather than nobody', () => {
    // It used to answer null whenever both were at the cap, which is how a
    // 12-10 finish — the exchange that decides a bout held open at 10-10 —
    // would have completed with no winner all over again.
    expect(pointCapWinnerColor(score(12, 10), CONFIG)).toBe('red');
    expect(pointCapWinnerColor(score(10, 11), CONFIG)).toBe('blue');
  });

  it('still answers nobody on a genuine tie', () => {
    expect(pointCapWinnerColor(score(10, 10), CONFIG)).toBeNull();
  });
});

describe('the end decisions both rulesets run', () => {
  it('endOnPointCapOrMaxDoubles keeps a level bracket bout open', () => {
    expect(endOnPointCapOrMaxDoubles(BRACKET, score(10, 10), CONFIG)).toEqual({
      isOver: false,
      reason: null,
    });
    expect(endOnPointCapOrMaxDoubles(POOL, score(10, 10), CONFIG)).toEqual({
      isOver: true,
      reason: 'first_to_points',
    });
  });

  it('Generic_PointsCap does the same, from its own copy of the cap check', () => {
    // It has no doubles ceiling so it cannot share `endOnPointCapOrMaxDoubles`,
    // but the cap question is the same one and the answer must not differ.
    const match = (over: Partial<Match>): Match => ({
      id: 'm1',
      redRegistrationId: 'reg-red',
      blueRegistrationId: 'reg-blue',
      rulesetCode: 'Generic_PointsCap',
      rulesetVersion: '1.0.0',
      status: 'running',
      ...over,
    });
    const config = { matchFormat: CONFIG };

    expect(
      Generic_PointsCap.isMatchOver(
        match({ phaseType: 'single_elim', matchNumberLabel: 'QF1' }),
        score(10, 10),
        config,
      ),
    ).toEqual({ isOver: false, reason: null });
    expect(
      Generic_PointsCap.isMatchOver(match({ phaseType: 'pool' }), score(10, 10), config),
    ).toEqual({ isOver: true, reason: 'first_to_points' });
  });
});
