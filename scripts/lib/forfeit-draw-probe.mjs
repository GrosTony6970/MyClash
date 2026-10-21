/**
 * Check 15 of the RLS probe (`scripts/db-rls-probe.mjs`): a forfeit record has no winner exactly
 * when it counts as a draw (migration 0239, operator rulings 64, 71, 72).
 *
 * On the seed's bout, with its Registration as the Fighter who forfeits and the seed's second one
 * as the winner, each record is written AS THE OWNER (0238 leaves no web role a write on the
 * table) in a savepoint rolled back. A draw with no winner and a loss with one are taken; a draw
 * that names a winner and a loss that names none are refused, each by the pairing CHECK by name:
 * a policy list missing 'draw' would refuse the first for another reason. The seed's own forfeit
 * on the bout is voided, so the one-active index leaves room for each.
 */

import { BOUT, errorOf, TOURNAMENT } from './match-rules-probe-kit.mjs';

const FORFEITS = 'cccccccc-0000-4000-8000-00000000000a';
const OPPONENT = 'c0f00000-0000-4000-8000-00000000000a';
const PAIRING = 'match_forfeits_draw_has_no_winner';

const CASES = [
  { what: 'a draw with no winner', policy: 'draw', winner: null, refusedBy: null },
  { what: 'a loss with a winner', policy: 'fixed_loss', winner: OPPONENT, refusedBy: null },
  { what: 'a draw that names a winner', policy: 'draw', winner: OPPONENT, refusedBy: PAIRING },
  { what: 'a loss that names no winner', policy: 'fixed_loss', winner: null, refusedBy: PAIRING },
];

/** What is wrong, as sentences; none when all is right. */
export async function forfeitDrawFailures(tx) {
  const failures = [];
  for (const { what, policy, winner, refusedBy } of CASES) {
    const error = await errorOf(tx, async (sp) => {
      await sp`INSERT INTO match_forfeits
                 (match_id, tournament_id, forfeiting_registration_id, winner_registration_id,
                  reason, score_policy)
               VALUES (${BOUT}, ${TOURNAMENT}, ${FORFEITS}, ${winner}, 'injury', ${policy})`;
      // The two Registration keys are checked at commit (0237): forced here, inside the savepoint.
      await sp`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    if (!refusedBy && error) {
      failures.push(`check 15: ${what} is refused: ${error.message}`);
    } else if (refusedBy && error?.constraint_name !== refusedBy) {
      failures.push(
        `check 15: ${what} is not refused by ${refusedBy} (${error ? error.message : 'taken'})`,
      );
    }
  }
  return failures;
}
