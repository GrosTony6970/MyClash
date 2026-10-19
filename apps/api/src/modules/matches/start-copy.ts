import type { Logger } from '@nestjs/common';
import type { MatchRulesetStamp } from '../phases/match-ruleset';
import type { LatePress } from './late-press';

/**
 * The copy of the rules a Start from a pad's queue puts its bout on, or null to leave the bout on
 * the copy it holds.
 *
 * Ruling "Offline rules" (2026-10-16) and the rulings of 2026-10-17: the pad sends the copy its
 * screen showed with its Start, and only a Start pressed with no network keeps it; an online Start
 * takes the Tournament's (the bout's copy of now). A bout started on a tablet with no network is
 * still `scheduled` on the server, so a change of the Tournament's rules meanwhile moved it to a
 * new copy (`restampUnstartedMatches`); this Start puts it back.
 *
 * Trusted: only a copy this bout held, its current one or one in `earlier_rules_ids` (only the
 * stamp appends to it, with the bout's own old copy, 0229). Returned even when it is the current
 * copy: a stamp may land between the door's read and its write, and the write sets the copy with
 * `running` in one update (`ClockService.startOnCopy`).
 *
 * Nothing is read: a copy a bout held is there as long as the bout is (a copy goes only with its
 * Tournament, which takes its bouts with it), and it names its engine (0229, NOT NULL).
 */
export function startCopyOf(
  match: Record<string, unknown>,
  press: Pick<LatePress, 'startedUnder' | 'pressedWithoutNetwork'>,
  logger: Pick<Logger, 'warn'>,
): MatchRulesetStamp | null {
  const rulesId = press.startedUnder?.rulesId;
  if (!rulesId) return null;
  const bout = String(match['id']);
  const current = match['match_rules_id'];
  if (press.pressedWithoutNetwork !== true) {
    if (rulesId !== current) {
      logger.warn(
        `Bout ${bout}: an online Start named copy ${rulesId}; it takes ${String(current)}`,
      );
    }
    return null;
  }
  const earlier = Array.isArray(match['earlier_rules_ids']) ? match['earlier_rules_ids'] : [];
  if (rulesId !== current && !earlier.includes(rulesId)) {
    logger.warn(`Bout ${bout}: a Start named copy ${rulesId}, a copy this bout never held`);
    return null;
  }
  return { match_rules_id: rulesId };
}
