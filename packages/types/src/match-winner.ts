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
 * No stored winner is no winner: a draw, or a loss for both. There used to be a
 * score fallback, for bouts the clock completed with no winner; every path that
 * finishes a bout now stores its result, and the fallback named the leader of a
 * bout the doubles limit had called a draw (spec 2026-11-27-bout-result-is-stored,
 * ruling 1009). A stored winner matching NEITHER side means the caller handed
 * over a mismatched pairing: no winner.
 *
 * THE RULE ITSELF LIVES IN `@myclash/rules` as `winnerColorFrom`, so the
 * standings tables and a fighter's own record read the same answer. What stays
 * here is the status guard and this signature.
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
}): 'red' | 'blue' | null {
  if (input.status !== 'completed') return null;
  return winnerColorFrom(input);
}
