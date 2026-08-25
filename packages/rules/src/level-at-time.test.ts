import { describe, expect, it } from 'vitest';
import {
  chainAllowsLevelEnd,
  effectiveTimeLimitSeconds,
  getEffectiveBestOf,
  pendingLevelStep,
  timeIsFinished,
  type LevelStep,
  type Match,
  type MatchFormatConfig,
} from './index';

/**
 * What a LEVEL bout is worth, per phase.
 *
 * A bout that runs out of time now names its winner, so a completed bout with
 * no winner means exactly one thing: it was genuinely level. That is a real
 * result in a pool — the standings have a D column — and it is not one in an
 * elimination round, which cannot advance a draw and used to stall with nothing
 * to show for it. These two functions are how the organiser decides which.
 */
const DRAW: LevelStep = { kind: 'draw' };
const SUDDEN: LevelStep = { kind: 'sudden_death' };
const EXTRA = (seconds: number): LevelStep => ({ kind: 'extra_time', seconds });

function config(over: Partial<MatchFormatConfig['levelAtTime']> = {}): MatchFormatConfig {
  return {
    pointCap: 10,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 4,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [DRAW],
      bracket: [EXTRA(60), SUDDEN],
      finals: [EXTRA(60), SUDDEN],
      ...over,
    },
  };
}

describe('pendingLevelStep', () => {
  it('walks the phase chain one step per resolution recorded', () => {
    const c = config();
    expect(pendingLevelStep(c, 'single_elim', 'QF', 0)).toEqual(EXTRA(60));
    expect(pendingLevelStep(c, 'single_elim', 'QF', 1)).toEqual(SUDDEN);
    // Spent. The chain's last step is terminal and a terminal `draw` ends the
    // bout rather than being advanced to, so null means sudden death is live.
    expect(pendingLevelStep(c, 'single_elim', 'QF', 2)).toBeNull();
  });

  it('gives a pool bout a draw, and a Swiss round the pool chain', () => {
    const c = config();
    expect(pendingLevelStep(c, 'pool', 'L1-P1-M01', 0)).toEqual(DRAW);
    // A Swiss round is a group stage, and a config written before the Swiss
    // format exists carries no `swiss` key at all — so it inherits `pool`,
    // never `bracket`. The same fallback its clock uses.
    expect(pendingLevelStep(c, 'swiss', null, 0)).toEqual(DRAW);
    expect(effectiveTimeLimitSeconds(c, 'swiss', null)).toBe(90);
  });

  it('reads a configured Swiss chain when there is one', () => {
    const c = config({ swiss: [SUDDEN] });
    expect(pendingLevelStep(c, 'swiss', null, 0)).toEqual(SUDDEN);
    // …and leaves the pool it would otherwise have inherited alone.
    expect(pendingLevelStep(c, 'pool', null, 0)).toEqual(DRAW);
  });

  it('sends a medal match to the finals chain, by LABEL not by round', () => {
    // A bronze match sits in the same bracket round as nothing else, so the
    // label is the only thing that distinguishes it. A fourth hand-written copy
    // of this dispatch is exactly what would get it wrong.
    const c = config({ finals: [SUDDEN], bracket: [EXTRA(30), DRAW] });
    expect(pendingLevelStep(c, 'single_elim', 'BRONZE', 0)).toEqual(SUDDEN);
    expect(pendingLevelStep(c, 'single_elim', 'F', 0)).toEqual(SUDDEN);
    expect(pendingLevelStep(c, 'single_elim', 'SF', 0)).toEqual(EXTRA(30));
  });

  it('treats an unknown phase as bracket, matching the time-limit dispatch', () => {
    const c = config({ bracket: [SUDDEN] });
    expect(pendingLevelStep(c, undefined, null, 0)).toEqual(SUDDEN);
    const match = { phaseType: undefined, matchNumberLabel: null } as unknown as Match;
    expect(getEffectiveBestOf(match, c)).toBe(c.bestOf.bracket);
  });
});

describe('chainAllowsLevelEnd', () => {
  it('answers from the chain CONTENT, not from how far along it the bout is', () => {
    // This is the guard on the AUTOMATIC end conditions — both fighters can
    // cross the point cap on the same exchange (9-9 plus a 1-1 afterblow in
    // `full` mode is 10-10) and the point-cap winner is then nobody. No server
    // state is involved, so two reads cannot disagree.
    const c = config();
    expect(chainAllowsLevelEnd(c, 'pool', null)).toBe(true);
    expect(chainAllowsLevelEnd(c, 'single_elim', 'QF')).toBe(false);
    expect(chainAllowsLevelEnd(c, 'single_elim', 'F')).toBe(false);
  });

  it('is true wherever a draw appears in the chain, not only at the end', () => {
    expect(chainAllowsLevelEnd(config({ bracket: [EXTRA(60), DRAW] }), 'single_elim', 'QF')).toBe(
      true,
    );
    expect(chainAllowsLevelEnd(config({ pool: [SUDDEN] }), 'pool', null)).toBe(false);
  });
});

/**
 * Whether the bout's time has run out — the rule the clock REFUSES on.
 *
 * A level bout may not be stopped while there is time left to fight, and the pad
 * may not offer the chain's remedy before then either. Both ask this, so the two
 * cannot disagree about whether a button should exist.
 */
describe('timeIsFinished', () => {
  const limits = (
    timeLimitsSeconds: MatchFormatConfig['timeLimitsSeconds'],
  ): MatchFormatConfig => ({ ...config(), timeLimitsSeconds });

  it('answers on the limit, not before it', () => {
    const c = limits({ pool: 90, bracket: 90, finals: 90 });
    expect(timeIsFinished(89_999, c, 'pool', null)).toBe(false);
    expect(timeIsFinished(90_000, c, 'pool', null)).toBe(true);
    expect(timeIsFinished(200_000, c, 'pool', null)).toBe(true);
  });

  it('answers TRUE when the phase has no limit at all', () => {
    // Reads as a lie against the name, and is deliberate: a phase with no time
    // limit has no time to wait for, so the guard must not hold such a bout
    // open forever. The level-at-time chain decides it instead.
    expect(timeIsFinished(0, limits({ pool: null, bracket: 90, finals: 90 }), 'pool', null)).toBe(
      true,
    );
  });

  it('bills each phase against its OWN limit', () => {
    // A bracket bout billed at the pool clock would stop a minute early. Swiss
    // inherits pool, and a medal label is read against finals.
    const c = limits({ pool: 60, bracket: 120, finals: 300 });
    expect(timeIsFinished(60_000, c, 'pool', null)).toBe(true);
    expect(timeIsFinished(60_000, c, 'swiss', null)).toBe(true);
    expect(timeIsFinished(60_000, c, 'single_elim', 'QF1')).toBe(false);
    expect(timeIsFinished(120_000, c, 'single_elim', 'QF1')).toBe(true);
    expect(timeIsFinished(120_000, c, 'single_elim', 'F')).toBe(false);
  });

  it('ignores timerMode, which is display only', () => {
    // The bout ends at the limit whether or not the scoreboard counts towards
    // it — the same reading `shouldWarnClock` states in @myclash/types.
    const countdown = limits({ pool: 90, bracket: 90, finals: 90 });
    const countup: MatchFormatConfig = { ...countdown, timerMode: 'countup' };
    expect(timeIsFinished(89_000, countup, 'pool', null)).toBe(
      timeIsFinished(89_000, countdown, 'pool', null),
    );
    expect(timeIsFinished(90_000, countup, 'pool', null)).toBe(true);
  });
});
