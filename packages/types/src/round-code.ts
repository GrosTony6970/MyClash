/**
 * Match round code: a short, human-readable identifier for a single
 * match. Operators announce matches by code over a PA system; the
 * code lives on match cards, scoring screens, and CSV/PDF exports.
 *
 * Format:
 *   Pool match    →  <WEAPON>-P<pool_num>-M<match_num>      e.g. LSW-P1-M3
 *   Swiss match   →  <WEAPON>-S<round_num>-M<match_num>     e.g. LSW-S3-M2
 *   Bracket match →  <WEAPON>-B-<ROUND>-M<match_num>        e.g. LSW-B-QF-M1
 *   Play-in match →  <WEAPON>-B-PI-M<match_num>             e.g. LSW-B-PI-M5
 *
 * The B segment marks every bracket-tier match so pool vs bracket vs
 * play-in is unambiguous at a glance (operators previously couldn't
 * tell LSW-M1 apart from LSW-QF-M1 without context). Play-ins are
 * single-elim slots at `bracket_slots.round === 0` (seed-in matches
 * before the main bracket).
 *
 * A Swiss match has neither a pool nor a bracket slot, so without its
 * own S segment it produced exactly that ambiguity again — a bare
 * LSW-M1 with no middle segment at all.
 *
 * Weapon abbreviations: canonical 5 weapons (LSW / SDW / RAP / SBR / SB)
 * plus a deterministic first-3-letters-uppercased fallback for anything
 * else, so a custom weapon name like "Dussack" still produces a stable
 * code (DUS-P1-M1).
 *
 * Bracket round labels resolve to F / SF / QF / R16 / R32 / R64 / R128
 * based on how many fighters remain at that round (= 2^(total_rounds −
 * round + 1)) for single-elim brackets. Falls back to B<round> when the
 * bracket size is unknown — yielding the harmless double-B form
 * LSW-B-B2-M1 in that rare case.
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
   * `swiss_rounds.round_number` (1-indexed). Optional rather than required
   * because every non-Swiss caller predates it; absent behaves as null.
   */
  swissRound?: number | null;
  /**
   * Total fighters the bracket started with (tournaments.bracket_size).
   * Combined with bracketRound this resolves the position label
   * (R64/R32/R16/QF/SF/F). If unknown, the code falls back to B<round>.
   */
  bracketSize: number | null;
  /** Match number to display — match_number_label || round_number || ''. */
  matchNumber: number | string | null | undefined;
  /**
   * Double-elim round split (`phases.config_json`). When present, the round
   * label names the SECTION as well as the depth — a double-elim bracket has
   * three different rounds that a single-elim label would all call "F".
   */
  wbRounds?: number | null;
  lbRounds?: number | null;
}

/**
 * Pull the double-elim round split out of a `phases.config_json` blob.
 *
 * Every caller that has the phase config must spread this into
 * `formatRoundCode`; omitting it silently downgrades a double-elim bracket to
 * single-elim labels, which is not an error anywhere — the code just comes out
 * calling three different rounds "F". Shared so the exchange CSV and the
 * archive export cannot drift apart on it.
 */
export function roundCodeShapeFromConfig(
  config: Record<string, unknown> | null | undefined,
): Pick<RoundCodeInput, 'wbRounds' | 'lbRounds'> {
  return {
    wbRounds: typeof config?.['wbRounds'] === 'number' ? config['wbRounds'] : null,
    lbRounds: typeof config?.['lbRounds'] === 'number' ? config['lbRounds'] : null,
  };
}

/**
 * Bracket-position label for one round of a DOUBLE-elimination bracket.
 *
 * Absolute rounds run play-in(0) → WB(1..wbRounds) → LB(next lbRounds) →
 * GF → GFRESET. Without this, the winners-bracket final was labelled plain
 * `F` (indistinguishable from the actual grand final) and every losers /
 * grand-final round fell through to a bare `B<n>` — so the schedule sidebar
 * read "Round 5", "Round 8".
 */
export function doubleElimRoundLabel(round: number, wbRounds: number, lbRounds: number): string {
  if (round === 0) return 'PI';
  if (round <= wbRounds) {
    // Depth within the winners bracket, prefixed so it can't be mistaken for
    // the grand final. 2^(wbRounds - round + 1) fighters remain at this round.
    const suffix = bracketRoundLabel(round, 2 ** wbRounds);
    return `WB${suffix}`;
  }
  if (round <= wbRounds + lbRounds) return `LB${round - wbRounds}`;
  return round === wbRounds + lbRounds + 1 ? 'GF' : 'GFR';
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

  // Pool matches use a single P<n> segment, Swiss matches a single S<n>
  // segment; bracket matches get a B segment (plus the round label, or PI
  // for play-ins) so the pool/swiss/bracket/play-in distinction shows up in
  // the code itself. Swiss is tested before bracket only for readability —
  // the three sources are mutually exclusive on a real match row.
  let middle: string[] = [];
  if (input.poolNumber !== null && input.poolNumber !== undefined) {
    middle = [`P${input.poolNumber}`];
  } else if (input.swissRound !== null && input.swissRound !== undefined) {
    middle = [`S${input.swissRound}`];
  } else if (input.bracketRound !== null && input.bracketRound !== undefined) {
    // A double-elim bracket needs section-aware labels: three of its rounds
    // would otherwise all read as a single-elim "F".
    if (input.wbRounds && input.lbRounds !== null && input.lbRounds !== undefined) {
      middle = ['B', doubleElimRoundLabel(input.bracketRound, input.wbRounds, input.lbRounds)];
    } else if (input.bracketRound === 0) {
      middle = ['B', 'PI'];
    } else {
      middle = ['B', bracketRoundLabel(input.bracketRound, input.bracketSize)];
    }
  }

  return [w, ...middle, matchSegment(input.matchNumber)].filter(Boolean).join('-');
}

/**
 * Build the trailing `M<seq>` segment.
 *
 * `matchNumber` is usually a bare number (or numeric string), but pool
 * matches pass the stored `match_number_label` — a compound
 * `L<lice>-P<pool>-M<seq>` string (e.g. "L1-PA-M1"). Prefixing that whole
 * string with `M` produced the doubled code `LSW-P1-ML1-PA-M1`; instead we
 * pull the trailing match sequence so a pool match reads `LSW-P1-M1`
 * (the documented form). Bare numeric labels (bracket `slot.position`) and
 * other strings (e.g. "R1") are left untouched.
 */
function matchSegment(matchNumber: number | string | null | undefined): string {
  if (matchNumber === null || matchNumber === undefined || matchNumber === '') return '';
  if (typeof matchNumber === 'number') return `M${matchNumber}`;
  const trailing = /M(\d+)\s*$/.exec(matchNumber);
  return trailing ? `M${trailing[1]}` : `M${matchNumber}`;
}
