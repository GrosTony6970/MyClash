/**
 * Parse a round-bearing match code into a stable group key, human label,
 * and sort order so the Schedule sidebar can group matches by phase round
 * (Swiss rounds → Play-ins → Final), the same way pools group.
 *
 * Two code shapes carry a round:
 *   Bracket → `<WEAPON>-B-<ROUND>-M<n>` (`LSW-B-QF-M1`, `LSW-B-PI-M5`);
 *             the `<ROUND>` token is the segment right after `B`.
 *   Swiss   → `<WEAPON>-S<n>-M<m>` (`LSW-S3-M2`).
 * Pool codes (`LSW-P1-M3`) and anything without a round segment return
 * null, so only round-bearing matches get grouped.
 *
 * Label vocabulary mirrors bracketRoundLabel() in @myclash/types and
 * the BracketView round headers. Pure: no React, no I/O.
 *
 * Named `parseBracketRound` for its original bracket-only scope; kept as-is
 * because five call sites across web-admin import it from the package barrel
 * and a rename would buy nothing functional.
 */
export interface BracketRound {
  /** Round token from the code: S<n> / PI / R16 / QF / SF / F / B<n>. */
  token: string;
  /** Human label, e.g. "Swiss Round 3", "Play-ins", "Quarter-finals". */
  label: string;
  /** Sort order, ascending = Swiss rounds first … final last. */
  order: number;
}

export function parseBracketRound(roundCode: string | undefined | null): BracketRound | null {
  if (!roundCode) return null;
  const parts = roundCode.split('-');

  // Swiss first: its S<n> segment sits where a pool's P<n> does, and there
  // is no `B` to key on. Unambiguous — a weapon abbreviation is letters-only
  // (weaponAbbr strips digits), pools use P and match numbers use M.
  const swiss = parseSwissToken(parts);
  if (swiss) return swiss;

  const bIdx = parts.indexOf('B');
  if (bIdx === -1 || bIdx + 1 >= parts.length) return null;
  const token = parts[bIdx + 1]!;

  if (token === 'PI') return { token, label: 'Play-ins', order: 0 };

  const de = parseDoubleElimToken(token);
  if (de) return de;

  // Named rounds map to a fighters-left count; earlier rounds (more
  // fighters) sort first, so order = 1000 − fightersLeft puts
  // R32 < R16 < QF(8) < SF(4) < F(2), all after play-ins (0).
  const FIGHTERS_LEFT: Record<string, number> = { F: 2, SF: 4, QF: 8 };
  const named = FIGHTERS_LEFT[token];
  if (named !== undefined) {
    const label = token === 'F' ? 'Final' : token === 'SF' ? 'Semi-finals' : 'Quarter-finals';
    return { token, label, order: 1000 - named };
  }

  // R<k> (Round of 128/64/32/16): k = fighters left at that round.
  const rMatch = /^R(\d+)$/.exec(token);
  if (rMatch) {
    const k = Number(rMatch[1]);
    return { token, label: `Round of ${k}`, order: 1000 - k };
  }

  // B<n>: the generator's fallback when the named round can't be
  // resolved (double-elim LB/GF rounds, unknown bracket size).
  // Group by absolute round number, sorted after the named rounds.
  const bMatch = /^B(\d+)$/.exec(token);
  if (bMatch) {
    const n = Number(bMatch[1]);
    return { token, label: `Round ${n}`, order: 1000 + n };
  }

  return null;
}

/**
 * Swiss round token (`S<n>`), scanned across the segments so the code shape
 * stays the parser's business rather than the caller's.
 *
 * Ordered BELOW play-ins (0) because a Swiss phase runs before any bracket it
 * feeds — in a Swiss → single-elim tournament the sidebar must read Swiss
 * Round 1 … Swiss Round 5, then Play-ins. The other bands start at 0 (PI),
 * 100 (WB), 500 (LB), 900 (GF) and 1000 (single-elim named + B<n> fallback),
 * so a negative band is the only one that cannot collide.
 */
function parseSwissToken(parts: string[]): BracketRound | null {
  for (const part of parts) {
    const m = /^S(\d+)$/.exec(part);
    if (!m) continue;
    const n = Number(m[1]);
    return { token: part, label: `Swiss Round ${n}`, order: -1000 + n };
  }
  return null;
}

/**
 * Double-elim section tokens (WB* / LB<n> / GF / GFR).
 *
 * Ordered play-ins → winners bracket → losers bracket → grand final, so the
 * sidebar reads in the order the day is actually run. Kept well below the
 * single-elim band (1000+) since the two never mix within one phase.
 */
function parseDoubleElimToken(token: string): BracketRound | null {
  if (token === 'GF') return { token, label: 'Grand Final', order: 900 };
  if (token === 'GFR') return { token, label: 'Grand Final Reset', order: 901 };

  const lbMatch = /^LB(\d+)$/.exec(token);
  if (lbMatch) {
    const k = Number(lbMatch[1]);
    return { token, label: `Losers Round ${k}`, order: 500 + k };
  }

  const wbMatch = /^WB(F|SF|QF|R\d+|B\d+)$/.exec(token);
  if (!wbMatch) return null;
  const inner = wbMatch[1]!;
  const NAMED: Record<string, { label: string; left: number }> = {
    F: { label: 'Winners Final', left: 2 },
    SF: { label: 'Winners Semi-finals', left: 4 },
    QF: { label: 'Winners Quarter-finals', left: 8 },
  };
  const hit = NAMED[inner];
  if (hit) return { token, label: hit.label, order: 100 + (1000 - hit.left) / 10 };
  const r = /^R(\d+)$/.exec(inner);
  if (r) {
    const k = Number(r[1]);
    return { token, label: `Winners Round of ${k}`, order: 100 + (1000 - k) / 10 };
  }
  return { token, label: `Winners ${inner}`, order: 199 };
}
