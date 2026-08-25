import { winnerColorFrom } from '@myclash/rules';

/**
 * Which side won a match — the one owner of that question.
 *
 * The rule, stated once so no surface has to re-derive it: the winner comes
 * from `winner_registration_id`, never from comparing the scores. A forfeit, a
 * walkover, or a `referee_decision` override can award a bout to the fighter
 * who is BEHIND on points — awarding a bout on the lower score is the canonical
 * reason explicit scores exist at all — and a draw has equal scores with no
 * winner. Eight display surfaces used to compare the two numbers instead, and
 * each of them bolded, badged or crowned the wrong fighter in exactly those
 * cases.
 *
 * The score fallback is deliberate and must stay. A completed match with no
 * stored winner is ordinary, not exotic: it is every bout that ends on the
 * clock or on max-doubles. Dropping the fallback would stop the projector
 * naming a winner for every time-limit bout in the hall.
 *
 * The `winnerRegistrationId !== null` guard is load-bearing too: a stored
 * winner matching NEITHER side means the caller handed over a mismatched
 * pairing, and answering "no winner" is honest where falling through to a score
 * comparison would invent one.
 *
 * THE RULE ITSELF NOW LIVES IN `@myclash/rules` as `winnerColorFrom`, because
 * the standings tables and a fighter's own record were deriving the same ladder
 * for themselves and disagreeing with this. What stays here is the status guard
 * and this signature — the eight display call sites are unaffected.
 *
 * Pure: no React, no I/O.
 */
export function resolveMatchWinner(input: {
  status: string;
  // Optional, not merely nullable: several caller types declare these with `?`
  // — `BracketSlotData`, the public `BracketSlot`, `MatchInfo` — and requiring
  // them would push a `?? null` coercion onto every call site, which is exactly
  // the kind of per-caller re-derivation this function exists to remove.
  winnerRegistrationId?: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  redScore?: number | null;
  blueScore?: number | null;
}): 'red' | 'blue' | null {
  if (input.status !== 'completed') return null;
  return winnerColorFrom(input);
}
