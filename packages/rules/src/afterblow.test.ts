import { describe, it, expect } from 'vitest';
import { computeAfterblowDeltas } from './afterblow';

describe('computeAfterblowDeltas', () => {
  it('full mode pays both fighters their raw button values', () => {
    expect(computeAfterblowDeltas('full', 2, 1)).toEqual({ attackerDelta: 2, defenderDelta: 1 });
  });

  it('deductive mode charges the afterblow to the attacker, and the defender scores 0', () => {
    expect(computeAfterblowDeltas('deductive', 2, 1)).toEqual({
      attackerDelta: 1,
      defenderDelta: 0,
    });
  });

  it('deductive never goes negative — a bigger afterblow floors the attacker at 0', () => {
    expect(computeAfterblowDeltas('deductive', 1, 2)).toEqual({
      attackerDelta: 0,
      defenderDelta: 0,
    });
  });

  it('the mode changes the answer', () => {
    const full = computeAfterblowDeltas('full', 2, 1);
    const deductive = computeAfterblowDeltas('deductive', 2, 1);

    expect(deductive.attackerDelta).toBeLessThan(full.attackerDelta);
    expect(deductive.defenderDelta).toBeLessThan(full.defenderDelta);
  });
});
