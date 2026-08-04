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

/**
 * The bracket-position token for one match's round — `SF`, `R16`, `PI`, `GF`,
 * `LB2`, `WBQF`, or the `B<n>` fallback.
 *
 * This is the exact token `formatRoundCode` embeds after the `B` segment, and
 * it is the input `roundTokenLabel` expands into a human phase name. Extracted
 * so a surface that wants the round WITHOUT the surrounding code (the TV
 * header, the scoring pad) cannot drift from the code the operator announces:
 * both now read the same function, and both stay section-aware for double-elim
 * (where three different rounds would otherwise all be labelled "F").
 *
 * Returns null when the match has no bracket round at all (pool / Swiss).
 */
export function bracketToken(
  input: Pick<RoundCodeInput, 'bracketRound' | 'bracketSize' | 'wbRounds' | 'lbRounds'>,
): string | null {
  const { bracketRound } = input;
  if (bracketRound === null || bracketRound === undefined) return null;
  if (input.wbRounds && input.lbRounds !== null && input.lbRounds !== undefined) {
    return doubleElimRoundLabel(bracketRound, input.wbRounds, input.lbRounds);
  }
  if (bracketRound === 0) return 'PI';
  return bracketRoundLabel(bracketRound, input.bracketSize) || null;
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
    // would otherwise all read as a single-elim "F". bracketToken owns that
    // decision so the code and the display label cannot disagree. The `B`
    // segment stays even when the round can't be labelled (`?? ''`, dropped by
    // the filter below) — the match IS in a bracket, which is what B marks.
    middle = ['B', bracketToken(input) ?? ''];
  }

  return [w, ...middle, matchSegment(input.matchNumber)].filter(Boolean).join('-');
}

/** An i18n key plus its interpolation params — see {@link roundTokenLabel}. */
export interface RoundLabelDescriptor {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Expand a round token into the human phase name operators actually say out
 * loud: `SF` → "Semi Final", `LB2` → "Losers Round 2", `S3` → "Swiss Round 3".
 *
 * Returns an i18n KEY rather than a string so this module stays pure and
 * locale-agnostic — every consumer (TV display, scoring pad, bracket headers)
 * runs it through its own translator, and French finally gets round names at
 * all. `bracketRoundLabel`/`formatRoundCode` keep emitting the short tokens:
 * the codes on match cards, `parseBracketRound`, `computeMatchKind` and
 * `groupBracketPoolsBySection` all parse those back, so the abbreviations are
 * load-bearing and only the PRESENTATION widens here.
 *
 * Accepts the Swiss `S<n>` token too, which no bracket function emits — the TV
 * header needs one field that names the phase for every kind of match, and a
 * Swiss bout previously showed no phase whatsoever.
 *
 * Returns null for an unrecognised token so callers can omit the segment
 * rather than render a raw code at the audience.
 */
export function roundTokenLabel(token: string | null | undefined): RoundLabelDescriptor | null {
  if (!token) return null;

  const NAMED: Record<string, string> = {
    F: 'common.round.final',
    SF: 'common.round.semiFinal',
    QF: 'common.round.quarterFinal',
    PI: 'common.round.playIn',
    GF: 'common.round.grandFinal',
    GFR: 'common.round.grandFinalReset',
    WBF: 'common.round.winnersFinal',
    WBSF: 'common.round.winnersSemiFinal',
    WBQF: 'common.round.winnersQuarterFinal',
  };
  const named = NAMED[token];
  if (named) return { key: named };

  // Counted forms. Each pattern is anchored so `WBR16` can't be mistaken for
  // `R16` — the winners-bracket prefixes are tested first for that reason.
  const wbRoundOf = /^WBR(\d+)$/.exec(token);
  if (wbRoundOf) return { key: 'common.round.winnersRoundOf', params: { count: wbRoundOf[1]! } };

  const wbFallback = /^WBB(\d+)$/.exec(token);
  if (wbFallback) return { key: 'common.round.winnersRound', params: { n: wbFallback[1]! } };

  const losers = /^LB(\d+)$/.exec(token);
  if (losers) return { key: 'common.round.losersRound', params: { n: losers[1]! } };

  const swiss = /^S(\d+)$/.exec(token);
  if (swiss) return { key: 'common.round.swissRound', params: { n: swiss[1]! } };

  const roundOf = /^R(\d+)$/.exec(token);
  if (roundOf) return { key: 'common.round.roundOf', params: { count: roundOf[1]! } };

  const fallback = /^B(\d+)$/.exec(token);
  if (fallback) return { key: 'common.round.bracketRound', params: { n: fallback[1]! } };

  return null;
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
