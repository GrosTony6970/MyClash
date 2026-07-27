import type { MatchRulesetStamp } from './match-ruleset';

/**
 * The `matches` row shape pre-created for a freshly generated bracket slot.
 *
 * Every non-bye slot gets one at generation time, even when its fighters
 * won't be known until upstream rounds finish — the schedule grid keys off
 * `matches` rows existing, so pre-creating them is what lets an operator drag
 * every R2/QF/SF/Final slot onto the day's grid before anything is played.
 * BracketAdvanceService later UPDATEs registrations into the existing row
 * rather than INSERTing a fresh one, which preserves any placement the
 * operator already made.
 */
export function placeholderMatchRow(
  slot: Record<string, unknown>,
  rulesetStamp: MatchRulesetStamp,
): Record<string, unknown> {
  return {
    phase_id: slot['phase_id'],
    bracket_slot_id: slot['id'],
    red_registration_id:
      typeof slot['registration_a_id'] === 'string' ? slot['registration_a_id'] : null,
    blue_registration_id:
      typeof slot['registration_b_id'] === 'string' ? slot['registration_b_id'] : null,
    ...rulesetStamp,
    status: 'scheduled',
    red_score: 0,
    blue_score: 0,
    // Stamp the bracket-local match number so buildRoundCode renders the same
    // canonical code (LSW-R16-M1) the bracket view shows. Without this stamp
    // the scoreboard fell through to B{round}.
    match_number_label: typeof slot['position'] === 'number' ? String(slot['position']) : null,
  };
}
