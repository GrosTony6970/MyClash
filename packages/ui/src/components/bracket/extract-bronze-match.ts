import type { BracketSlotData } from './types';

/**
 * Split a flat bracket-slot array into (bronze, main slots).
 *
 * Single-elim brackets that end with a bronze match label the bronze
 * slot as `position === 2` at the maximum round (the gold final lives
 * at `position === 0`). The renderer (`BracketView`) renders the bronze
 * separately from the main bracket via its own `bronzeMatch` prop —
 * leaving bronze inside the generic `slots` array makes the layout
 * collapse both finals into one card slot at the SF-midpoint.
 *
 * Returns `{ bronze: null, mainSlots: slots }` when no position-2 slot
 * exists at the max round (single-elim without a bronze, pool-only,
 * or empty bracket).
 *
 * Pure function — safe to call on every render. Used by `BracketLive`
 * on the public side and (already) by the admin bracket page.
 */
export function extractBronzeMatch(slots: readonly BracketSlotData[]): {
  bronze: BracketSlotData | null;
  mainSlots: BracketSlotData[];
} {
  if (slots.length === 0) {
    return { bronze: null, mainSlots: [] };
  }
  const maxRound = slots.reduce((max, s) => Math.max(max, s.round ?? 0), 0);
  const bronze = slots.find((s) => s.round === maxRound && s.position === 2) ?? null;
  const mainSlots = bronze ? slots.filter((s) => s.id !== bronze.id) : [...slots];
  return { bronze, mainSlots };
}
