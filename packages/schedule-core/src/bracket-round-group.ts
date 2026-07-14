/**
 * Parse a bracket match's round code into a stable group key, human
 * label, and sort order so the Schedule sidebar can group bracket
 * matches by phase round (Play-ins → Final), the same way pools group.
 *
 * Round codes look like `<WEAPON>-B-<ROUND>-M<n>` (e.g. `LSW-B-QF-M1`,
 * `LSW-B-PI-M5`); the `<ROUND>` token is the segment right after `B`.
 * Pool codes (`LSW-P1-M3`) and anything without that segment return
 * null, so only bracket matches get grouped.
 *
 * Label vocabulary mirrors bracketRoundLabel() in @myclash/types and
 * the BracketView round headers. Pure: no React, no I/O.
 */
export interface BracketRound {
  /** Round token from the code: PI / R16 / QF / SF / F / B<n>. */
  token: string;
  /** Human label, e.g. "Play-ins", "Round of 16", "Quarter-finals". */
  label: string;
  /** Sort order, ascending = play-ins first … final last. */
  order: number;
}

export function parseBracketRound(roundCode: string | undefined | null): BracketRound | null {
  if (!roundCode) return null;
  const parts = roundCode.split('-');
  const bIdx = parts.indexOf('B');
  if (bIdx === -1 || bIdx + 1 >= parts.length) return null;
  const token = parts[bIdx + 1]!;

  if (token === 'PI') return { token, label: 'Play-ins', order: 0 };

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
