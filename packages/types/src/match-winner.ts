import { winnerColorFrom } from '@myclash/rules/pad';

/**
 * Which side won a match — the one owner of that question.
 *
 * The rule, stated once so no surface has to re-derive it: the winner comes
 * from the recorded winner (`winner_registration_id`, or `winner_team_id` for a
 * team bout), never from comparing the scores. A forfeit, a
 * walkover, or a `referee_decision` override can award a bout to the fighter
 * who is BEHIND on points — awarding a bout on the lower score is the canonical
 * reason explicit scores exist at all — and a draw has equal scores with no
 * winner. Nine display surfaces used to compare the two numbers instead, and
 * each of them bolded, badged or crowned the wrong fighter in exactly those
 * cases.
 *
 * The score fallback is deliberate and must stay. A completed match with no
 * stored winner is ordinary, not exotic: it is every bout that ends on the
 * clock or on max-doubles. Dropping the fallback would stop the projector
 * naming a winner for every time-limit bout in the hall.
 *
 * The `winnerSideId !== null` guard is load-bearing too: a stored
 * winner matching NEITHER side means the caller handed over a mismatched
 * pairing, and answering "no winner" is honest where falling through to a score
 * comparison would invent one.
 *
 * THE RULE ITSELF NOW LIVES IN `@myclash/rules` as `winnerColorFrom`, because
 * the standings tables and a fighter's own record were deriving the same ladder
 * for themselves and disagreeing with this. What stays here is the status guard
 * and this signature — the nine display call sites are unaffected. It comes
 * through the `/pad` door: the root barrel would ship the whole competition core
 * to every page of every app.
 *
 * Pure: no React, no I/O.
 */
export function resolveMatchWinner(input: {
  status: string;
  // Required keys, each of them nullable: a caller names all three side ids. With optional keys a
  // caller that passed a whole object still compiled after a rename, found no recorded winner and
  // fell back to the score in silence, crowning the side ahead on points over a forfeit winner.
  winnerSideId: string | null | undefined;
  redSideId: string | null | undefined;
  blueSideId: string | null | undefined;
  redScore?: number | null;
  blueScore?: number | null;
}): 'red' | 'blue' | null {
  if (input.status !== 'completed') return null;
  return winnerColorFrom({
    winnerSideId: input.winnerSideId,
    redSideId: input.redSideId,
    blueSideId: input.blueSideId,
    redScore: input.redScore,
    blueScore: input.blueScore,
  });
}
