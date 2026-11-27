import type { MessageTree } from '../../message-tree.js';

/**
 * Strings only the scoring pad reads. The public site loads `scoring` whole on every page
 * (`surfaces/public.ts`); a string here ships to the pad (`surfaces/staff.ts`) and not to the
 * public site, whose page-load budget is in `scripts/check-bundle-budgets.mjs`.
 */
export const pad = {
  quarantine: {
    // The API's `bout_side_missing`: a hit, a card or a Start for a bout that waits for a Fighter.
    boutSideMissing:
      'Held here, not lost: this bout was waiting for a Fighter. Retry once both Fighters are on the bout, or discard it.',
  },
  match: {
    // A bracket bout with a side still to come (operator, 2026-11-24).
    waitingForFighter:
      'Waiting for a Fighter. This bout takes no Start, hit, card or colour swap until both sides are known.',
  },
  corrections: {
    // The API's `bout_side_missing`, on a call sent at once (the colour swap), and the pad's own.
    boutSideMissing: 'This bout is waiting for a Fighter. Try again once both sides are known.',
  },
} as const satisfies MessageTree;
