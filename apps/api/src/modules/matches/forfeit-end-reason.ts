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

/** Named one by one: a value added above fails the typecheck until it is placed here. */
const RECORD_END_REASONS: Record<ReturnType<typeof forfeitEndReason>, true> = {
  black_card: true,
  forfeit: true,
  override: true,
};

/**
 * Does this bout's ROW say a `match_forfeits` record ended it?
 *
 * The row's half of ruling 322 (`ScoringService.heldByLiveRecord` asks the
 * record too). It costs no read, so a bout that ended on the board never pays
 * for the question. It is not enough alone: the hold ends with the record,
 * whatever a row still says, so no row can hold a bout for ever.
 */
export function endedByForfeitRecord(bout: { status?: unknown; end_reason?: unknown }): boolean {
  return (
    bout.status === 'completed' && Object.keys(RECORD_END_REASONS).includes(String(bout.end_reason))
  );
}
