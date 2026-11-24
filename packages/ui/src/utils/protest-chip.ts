/**
 * The protest chip's text and its warning, on the pad and on the TV scoreboard:
 * the count alone with no limit, `count/limit` with one, and the warning colour
 * from the limit on. The limit is the Tournament's (`protestRulesOf`).
 */

import type { MatchProtest } from '../types/match-events';
import { isSideRegistration } from './side-registration';

/**
 * The protests a chip counts: the Fighter's, not voided. The one rule for the
 * TV chip and the pad's chip (`protestsOf` in web-staff).
 */
export function liveProtestsOf(
  rows: readonly MatchProtest[],
  registrationId: string | null,
): MatchProtest[] {
  return rows.filter((p) => !p.voided && isSideRegistration(p.registration_id, registrationId));
}

/** `"2"` with no limit, `"2/2"` with a limit of 2. */
export function protestChipText(count: number, limit: number | null): string {
  return limit === null ? String(count) : `${count}/${limit}`;
}

/** The Fighter reached the limit, or passed it: the chip turns to the warning colour. */
export function protestAtLimit(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}
