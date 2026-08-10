import { isOverrideReason } from '@myclash/rulesets';

/**
 * Map a forfeit reason to the persisted `matches.end_reason` value so the
 * referee pad + external scoreboard can label HOW a match ended.
 *
 * Three outcomes, because `match_forfeits` now holds two different things:
 *   - 'black_card' — black-card forfeits (the pad/TV show "BLACK CARD")
 *   - 'forfeit'    — every other forfeit reason
 *   - 'override'   — a corrected result. Nobody forfeited, so labelling one
 *                    "FORFEIT" on the pad and the hall screen would announce a
 *                    withdrawal that never happened.
 *
 * Forfeit reasons: 'injury' | 'voluntary' | 'black_card_1' | 'black_card_2'
 * | 'conduct_violation'. Override reasons: 'referee_decision' |
 * 'admin_correction' | 'technical_failure'. See CreateMatchForfeitDto, which
 * takes both from `@myclash/rulesets`.
 */
export function forfeitEndReason(reason: string): 'black_card' | 'forfeit' | 'override' {
  if (isOverrideReason(reason)) return 'override';
  return reason === 'black_card_1' || reason === 'black_card_2' ? 'black_card' : 'forfeit';
}
