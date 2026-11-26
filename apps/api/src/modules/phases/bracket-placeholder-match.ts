import type { MatchRulesetStamp } from './match-ruleset';
import { boutSidesOfSlot } from './seat-columns';

const idOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

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
 *
 * Both columns of each side come from the slot (`boutSidesOfSlot`): a Registration or a team
 * (0282), null at generation.
 */
export function placeholderMatchRow(
  slot: Record<string, unknown>,
  rulesetStamp: MatchRulesetStamp,
): Record<string, unknown> {
  return {
    phase_id: slot['phase_id'],
    bracket_slot_id: slot['id'],
    ...boutSidesOfSlot({
      registration_a_id: idOf(slot['registration_a_id']),
      registration_b_id: idOf(slot['registration_b_id']),
      team_a_id: idOf(slot['team_a_id']),
      team_b_id: idOf(slot['team_b_id']),
    }),
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
