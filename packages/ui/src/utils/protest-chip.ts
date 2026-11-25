/**
 * The protest chip's text and its warning, on the pad and on the TV scoreboard:
 * the count alone with no limit, `count/limit` with one, and the warning colour
 * from the limit on. The limit is the Tournament's (`protestRulesOf`).
 */

import type { MatchProtest } from '../types/match-events';
import { isRowOfSide } from './exchange-timeline';

/**
 * The protests a chip counts: the side's (its Fighter's or its team's), not voided. The one rule
 * for the TV chip and the pad's chip (`protestsOf` in web-staff). `sideId` is the side key; a side
 * with no key is nobody and counts none (`isRowOfSide`).
 */
export function liveProtestsOf(
  rows: readonly MatchProtest[],
  sideId: string | null,
): MatchProtest[] {
  return rows.filter((p) => !p.voided && isRowOfSide(p, sideId));
}

/** `"2"` with no limit, `"2/2"` with a limit of 2. */
export function protestChipText(count: number, limit: number | null): string {
  return limit === null ? String(count) : `${count}/${limit}`;
}

/** The Fighter reached the limit, or passed it: the chip turns to the warning colour. */
export function protestAtLimit(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}
