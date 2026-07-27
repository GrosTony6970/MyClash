/**
 * Shared assertions for the double-elimination generator tests.
 *
 * Lives in its own module so `double-elim.test.ts` (classical brackets) and
 * `double-elim-shape.test.ts` (podium options and repechage cutoffs) check the
 * SAME invariant. A ref that names a slot which doesn't exist is a permanent
 * deadlock, not a cosmetic bug, so this is the assertion that matters most.
 */

import { expect } from 'vitest';
import type { DoubleElimBracket, DoubleElimSlot } from './double-elim';

/**
 * Every slot's canonical self-reference, mirroring
 * `BracketAdvanceService.buildSelfRef` exactly. Advancement is driven by
 * string matching between a completed slot's self-ref and downstream
 * `source_*_ref` values.
 */
export function selfRef(slot: DoubleElimSlot, b: DoubleElimBracket): string {
  if (slot.round <= b.wbRounds) return `WBR${slot.round}P${slot.position}`;
  if (slot.round <= b.wbRounds + b.lbRounds) {
    return `LBR${slot.round - b.wbRounds}P${slot.position}`;
  }
  return slot.round === b.wbRounds + b.lbRounds + 1 ? 'GF' : 'GFRESET';
}

/** Assert every advancement ref resolves to a slot that actually exists. */
export function expectRefsResolve(b: DoubleElimBracket): void {
  const known = new Set(b.slots.map((s) => selfRef(s, b)));
  for (const slot of b.slots) {
    for (const ref of [slot.homeSource, slot.awaySource]) {
      const advance = /^(?:winner|loser) of (.+)$/.exec(ref);
      if (advance) {
        expect(known, `${ref} (from ${selfRef(slot, b)}) must name a real slot`).toContain(
          advance[1]!,
        );
        continue;
      }
      const seed = /^seed (\d+)$/.exec(ref);
      expect(seed, `unrecognised source ref "${ref}"`).not.toBeNull();
      expect(Number(seed![1])).toBeGreaterThanOrEqual(1);
      expect(Number(seed![1])).toBeLessThanOrEqual(b.fighterCount);
    }
  }
}

/** Match counts per losers-bracket round, in round order. */
export function lbRoundSizes(b: DoubleElimBracket): number[] {
  return Array.from(
    { length: b.lbRounds },
    (_, i) => b.slots.filter((s) => s.round === b.wbRounds + i + 1).length,
  );
}
