/**
 * Split a flat bracket-slot list into the bronze bout and the main bracket — the one owner of the
 * rule, for the public bracket, the staff piste screen, the final ranking and the API's Claude tool.
 *
 * The bronze bout is position 2 of the last round. Positions start at 1, and the Final is
 * position 1 of that same round (`single-elim.ts` in `@myclash/rules` generates both).
 * `BracketView` renders it apart through its own `bronzeMatch` prop: left inside `slots`, the
 * layout collapses both finals into one card at the semi-final midpoint.
 *
 * A double-elimination bracket is drawn as WB / LB / Grand Final lanes and keeps its last round
 * whole: the split is for single elimination only. So `phaseType === 'double_elim'` answers no
 * bronze and every slot as main.
 *
 * Answers `bronze: null` and every slot as main when the last round has no position-2 slot
 * (single elimination without a bronze bout, or an empty bracket). The bronze slot is taken out by
 * identity, so the caller's slots need no id.
 *
 * Pure — safe to call on every render.
 */
export function extractBronzeMatch<T extends { round: number; position: number }>(
  slots: readonly T[],
  phaseType: string | null | undefined,
): { bronze: T | null; mainSlots: T[] } {
  if (phaseType === 'double_elim') return { bronze: null, mainSlots: [...slots] };
  const maxRound = slots.reduce((max, s) => Math.max(max, s.round), 0);
  const bronze = slots.find((s) => s.round === maxRound && s.position === 2) ?? null;
  const mainSlots = bronze ? slots.filter((s) => s !== bronze) : [...slots];
  return { bronze, mainSlots };
}
