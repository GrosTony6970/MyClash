/**
 * Match round code: a short, human-readable identifier for a single
 * match. Operators announce matches by code over a PA system; the
 * code lives on match cards, scoring screens, and CSV/PDF exports.
 *
 * Format:
 *   Pool match    →  <WEAPON>-P<pool_num>-M<match_num>     e.g. LSW-P1-M3
 *   Bracket match →  <WEAPON>-<ROUND>-M<match_num>          e.g. LSW-QF-M1
 *
 * Weapon abbreviations: canonical 5 weapons (LSW / SDW / RAP / SBR / SB)
 * plus a deterministic first-3-letters-uppercased fallback for anything
 * else, so a custom weapon name like "Dussack" still produces a stable
 * code (DUS-P1-M1).
 *
 * Bracket round labels resolve to F / SF / QF / R16 / R32 / R64 / R128
 * based on how many fighters remain at that round (= 2^(total_rounds −
 * round + 1)) for single-elim brackets. Falls back to B<round> when the
 * bracket size is unknown.
 *
 * The whole module is pure — no I/O, no React, no Node-only APIs — so
 * it works identically in the NestJS API (exports) and every web app
 * (match cards, scoreboard).
 */

export const WEAPON_ABBREVIATIONS: Record<string, string> = {
  longsword: 'LSW',
  sidesword: 'SDW',
  rapier: 'RAP',
  sabre: 'SBR',
  'sword & buckler': 'SB',
  'sword and buckler': 'SB',
};

export function weaponAbbr(weapon: string | null | undefined): string {
  const key = (weapon ?? '').trim().toLowerCase();
  if (WEAPON_ABBREVIATIONS[key]) return WEAPON_ABBREVIATIONS[key];
  const letters = (weapon ?? '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return letters || '???';
}

export interface RoundCodeInput {
  weapon: string | null | undefined;
  /** Pool sort_order + 1; null for bracket matches. */
  poolNumber: number | null;
  /** bracket_slots.round (1-indexed: 1 = first round, last = final). */
  bracketRound: number | null;
  /**
   * Total fighters the bracket started with (tournaments.bracket_size).
   * Combined with bracketRound this resolves the position label
   * (R64/R32/R16/QF/SF/F). If unknown, the code falls back to B<round>.
   */
  bracketSize: number | null;
  /** Match number to display — match_number_label || round_number || ''. */
  matchNumber: number | string | null | undefined;
}

/**
 * Returns the bracket-position label for a given round.
 *
 *   round 1 in a 32-bracket → R32
 *   round 3 in a 32-bracket → QF
 *   round 5 in a 32-bracket → F
 *
 * Bye-padded brackets (e.g. 24 fighters) round up to the next power of
 * two; the label still names the correct depth because byes don't
 * actually play.
 */
export function bracketRoundLabel(round: number, bracketSize: number | null): string {
  if (!Number.isInteger(round) || round < 1) return '';
  if (!bracketSize || bracketSize < 2) return `B${round}`;
  const totalRounds = Math.ceil(Math.log2(bracketSize));
  const fightersLeft = 2 ** (totalRounds - round + 1);
  switch (fightersLeft) {
    case 2:
      return 'F';
    case 4:
      return 'SF';
    case 8:
      return 'QF';
    default:
      return fightersLeft >= 16 ? `R${fightersLeft}` : `B${round}`;
  }
}

export function formatRoundCode(input: RoundCodeInput): string {
  const w = weaponAbbr(input.weapon);
  const middle =
    input.poolNumber !== null && input.poolNumber !== undefined
      ? `P${input.poolNumber}`
      : input.bracketRound !== null && input.bracketRound !== undefined
        ? bracketRoundLabel(input.bracketRound, input.bracketSize)
        : '';
  const tail =
    input.matchNumber !== null && input.matchNumber !== undefined && input.matchNumber !== ''
      ? `M${input.matchNumber}`
      : '';
  return [w, middle, tail].filter(Boolean).join('-');
}
