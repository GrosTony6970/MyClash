/**
 * Pure helpers for bracket advancement ref strings.
 *
 * Advancement is driven entirely by string matching: a completed slot builds
 * its own canonical ref, and downstream slots are found by looking for
 * `winner of {ref}` / `loser of {ref}` in their `source_*_ref` columns. These
 * strings must therefore agree EXACTLY with what the generators in
 * `@myclash/rulesets` emit — a mismatch is a silent permanent stall, not an
 * error. Extracted from BracketAdvanceService so they can be tested directly.
 */

export interface PhaseConfig {
  autoAdvance?: boolean;
  grandFinalReset?: boolean;
  wbRounds?: number;
  lbRounds?: number;
}

/**
 * The canonical self-reference for a slot, matching the round numbering used
 * by `singleElimBracket` / `doubleElimBracket`.
 *
 * Double-elim round 0 (the play-in) falls into the `round <= wbRounds` branch
 * and stamps as `WBR0P{n}`, which is what the generator's WB-R1 slots point at.
 */
export function buildSelfRef(
  round: number,
  position: number,
  phaseType: string,
  config: PhaseConfig,
): string {
  if (phaseType === 'single_elim') return `R${round}P${position}`;

  // double_elim
  const wbRounds = config.wbRounds ?? 0;
  const lbRounds = config.lbRounds ?? 0;
  if (round <= wbRounds) return `WBR${round}P${position}`;
  if (round <= wbRounds + lbRounds) return `LBR${round - wbRounds}P${position}`;
  if (round === wbRounds + lbRounds + 1) return 'GF';
  return 'GFRESET';
}

export function resolveLoser(match: {
  winner_registration_id: string;
  red_registration_id: string;
  blue_registration_id: string;
}): string {
  return match.winner_registration_id === match.red_registration_id
    ? match.blue_registration_id
    : match.red_registration_id;
}

/**
 * True when a completed double-elim grand final ends the bracket, so nothing
 * downstream should be filled.
 *
 * The reset slot exists in the structure whenever `grandFinalReset` is on, but
 * it is only PLAYED when the losers-bracket entrant wins the grand final: the
 * winners-bracket entrant arrives unbeaten, so beating them once is enough.
 * Side A of the GF slot is the winners-bracket entrant
 * (`source_a_ref = 'winner of WBR{n}P1'`), so an A-side win ends it.
 *
 * Propagating regardless would materialise a match that must never be played
 * — and because that reset slot then sits at the bracket's highest round,
 * permanently incomplete, `computeFinalRanking` would find no decided final
 * and return an EMPTY ranking for the whole tournament, taking league
 * standings and career placements down with it.
 */
export function grandFinalEndsBracket(
  phaseType: string,
  config: PhaseConfig,
  slot: { round: number; registration_a_id: string | null },
  match: { winner_registration_id: string | null },
): boolean {
  if (phaseType !== 'double_elim' || config.grandFinalReset !== true) return false;
  const gfRound = (config.wbRounds ?? 0) + (config.lbRounds ?? 0) + 1;
  if (slot.round !== gfRound) return false;
  return (
    match.winner_registration_id !== null && match.winner_registration_id === slot.registration_a_id
  );
}
