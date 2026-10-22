import { describe, expect, it } from 'vitest';
import {
  acceptsLeaf,
  acceptsWinBonus,
  dialDiffers,
  differsFromEngine,
  shownDial,
  shownLeaf,
  storedOwn,
  withDial,
  withOwn,
  withoutOwn,
} from './ruleset-own-values';

/**
 * A ruleset's own values against the engine's (operator rulings 59, 60, 134, 137): what a field
 * shows, when it is "modified", and what an edit or a Reset leaves stored.
 */
describe('a match format field', () => {
  it('shows the engine’s value when the ruleset stores none', () => {
    expect(shownLeaf({}, 'pointCap')).toBe(10);
    expect(shownLeaf({}, 'pool')).toBe(90);
    expect(differsFromEngine({}, 'pointCap')).toBe(false);
  });

  it('shows a stored "no limit" as none, and badges it', () => {
    const own = { timeLimitsSeconds: { pool: null } };
    expect(shownLeaf(own, 'pool')).toBeNull();
    expect(differsFromEngine(own, 'pool')).toBe(true);
  });

  it('shows the engine’s value for a stored leaf the engine refuses, without a badge', () => {
    const own = { pointCap: null, softClockLimitSeconds: -1 };
    expect(shownLeaf(own, 'pointCap')).toBe(10);
    expect(shownLeaf(own, 'softClockLimitSeconds')).toBe(5);
    expect(differsFromEngine(own, 'pointCap')).toBe(false);
  });

  it('takes only what the engine takes', () => {
    expect(acceptsLeaf('pointCap', 0)).toBe(false);
    expect(acceptsLeaf('pointCap', 7)).toBe(true);
    expect(acceptsLeaf('pool', null)).toBe(true);
    expect(acceptsLeaf('softClockLimitSeconds', 0)).toBe(true);
  });
});

describe('an edit and a Reset', () => {
  it('stores the one leaf edited beside what was stored', () => {
    expect(withOwn({ bestOf: { pool: 3 } }, 'bracket', 120)).toEqual({
      bestOf: { pool: 3 },
      timeLimitsSeconds: { bracket: 120 },
    });
  });

  it('empties a leaf typed back to the engine’s value', () => {
    expect(withOwn({ pointCap: 7 }, 'pointCap', 10)).toEqual({});
  });

  it('removes the time limits once the last one is reset', () => {
    const own = { pointCap: 7, timeLimitsSeconds: { pool: 120 } };
    expect(withoutOwn(own, 'pool')).toEqual({ pointCap: 7 });
    expect(withoutOwn({ timeLimitsSeconds: { pool: 120, finals: 60 } }, 'pool')).toEqual({
      timeLimitsSeconds: { finals: 60 },
    });
  });

  it('keeps a Swiss time the box does not show when the pool is reset', () => {
    expect(withoutOwn({ timeLimitsSeconds: { pool: 120, swiss: 60 } }, 'pool')).toEqual({
      timeLimitsSeconds: { swiss: 60 },
    });
  });

  it('empties a time limit typed back to the engine’s value', () => {
    expect(withOwn({ timeLimitsSeconds: { pool: 120 } }, 'pool', 90)).toEqual({});
  });

  it('stores nothing when the ruleset sets nothing of its own', () => {
    expect(storedOwn({})).toBeNull();
    expect(storedOwn({ pointCap: 7 })).toEqual({ pointCap: 7 });
  });
});

describe('a TF v1 dial', () => {
  it('follows the engine unless set, and empties when the engine value is set back', () => {
    expect(shownDial({}, 'winBonus')).toBe(3);
    expect(dialDiffers({ winBonus: 5 }, 'winBonus')).toBe(true);
    expect(withDial({ winBonus: 5 }, 'winBonus', 3)).toEqual({});
    expect(withDial({}, 'doublePenaltyFormula', '0')).toEqual({ doublePenaltyFormula: '0' });
  });

  it('takes a win bonus the engine takes', () => {
    expect(acceptsWinBonus(0)).toBe(true);
    expect(acceptsWinBonus(-1)).toBe(false);
    expect(acceptsWinBonus(1.5)).toBe(false);
  });
});
