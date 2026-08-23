/**
 * Shared checks for the double-elimination generator tests.
 *
 * Lives in its own module so `double-elim.test.ts` (classical brackets) and
 * `double-elim-shape.test.ts` (podium options and repechage cutoffs) check the
 * SAME invariant. A ref that names a slot which doesn't exist is a permanent
 * deadlock, not a cosmetic bug, so this is the check that matters most.
 *
 * It REPORTS rather than asserts. `@myclash/rules` has zero dependencies —
 * that is the package's whole contract — and an `import { expect } from 'vitest'`
 * here is the exact incident `scripts/check-test-code-leak.mjs` was written for:
 * this file was emitted into the production api image, where vitest is not
 * installed. Returning findings keeps the invariant in one place and leaves the
 * assertion with the callers, which is where the test runner belongs.
 */

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

/**
 * Every advancement ref that does NOT resolve to a slot which exists, plus every
 * source ref in a shape nothing can advance through. Empty means the bracket is
 * wired end to end.
 */
export function unresolvedRefs(b: DoubleElimBracket): string[] {
  const known = new Set(b.slots.map((s) => selfRef(s, b)));
  const problems: string[] = [];

  for (const slot of b.slots) {
    const from = selfRef(slot, b);
    for (const ref of [slot.homeSource, slot.awaySource]) {
      const advance = /^(?:winner|loser) of (.+)$/.exec(ref);
      if (advance) {
        if (!known.has(advance[1]!)) problems.push(`${ref} (from ${from}) names no real slot`);
        continue;
      }

      const seed = /^seed (\d+)$/.exec(ref);
      if (!seed) {
        problems.push(`unrecognised source ref "${ref}" (from ${from})`);
        continue;
      }
      const number = Number(seed[1]);
      if (number < 1 || number > b.fighterCount) {
        problems.push(`${ref} (from ${from}) is outside 1..${b.fighterCount}`);
      }
    }
  }

  return problems;
}

/** Match counts per losers-bracket round, in round order. */
export function lbRoundSizes(b: DoubleElimBracket): number[] {
  return Array.from(
    { length: b.lbRounds },
    (_, i) => b.slots.filter((s) => s.round === b.wbRounds + i + 1).length,
  );
}
