/**
 * Map a forfeit reason to the persisted `matches.end_reason` value so the
 * referee pad + external scoreboard can label HOW a match ended. Black-card
 * forfeits get their own 'black_card' reason (the pad/TV show "BLACK CARD");
 * every other forfeit reason collapses to a generic 'forfeit'.
 *
 * Forfeit reasons: 'injury' | 'voluntary' | 'black_card_1' | 'black_card_2'
 * | 'conduct_violation' (see CreateMatchForfeitDto).
 */
export function forfeitEndReason(reason: string): 'black_card' | 'forfeit' {
  return reason === 'black_card_1' || reason === 'black_card_2' ? 'black_card' : 'forfeit';
}
