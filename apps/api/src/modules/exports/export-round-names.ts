/**
 * Human round names for CSV/PDF exports.
 *
 * Extracted from ExportsService so the naming rules live in one pure,
 * directly-testable place — and because a double-elim bracket needs a
 * different vocabulary entirely: three of its rounds would all read as
 * "Final" under the single-elim namer.
 */

export interface ExportBracketContext {
  /** bracket_slots.round for this match, when it has one. */
  round: number | null;
  /** The phase's config_json (carries wbRounds / lbRounds for double-elim). */
  config: Record<string, unknown> | null;
}

/**
 * Round name for a double-elim match, derived from the slot's ABSOLUTE round
 * plus the phase's wbRounds/lbRounds split.
 */
export function resolveDoubleElimRound(
  bracket: ExportBracketContext | undefined,
  matchLabel: string | null,
): string {
  const round = bracket?.round ?? null;
  const cfg = bracket?.config ?? {};
  const wbRounds = typeof cfg['wbRounds'] === 'number' ? cfg['wbRounds'] : null;
  const lbRounds = typeof cfg['lbRounds'] === 'number' ? cfg['lbRounds'] : null;
  if (round === null || wbRounds === null || lbRounds === null) {
    return matchLabel ?? 'Elimination';
  }
  if (round === 0) return 'Play-ins';
  if (round <= wbRounds) {
    const left = 2 ** (wbRounds - round + 1);
    if (left === 2) return 'Winners Final';
    if (left === 4) return 'Winners Semi-finals';
    if (left === 8) return 'Winners Quarter-finals';
    return `Winners Round of ${left}`;
  }
  if (round <= wbRounds + lbRounds) return `Losers Round ${round - wbRounds}`;
  return round === wbRounds + lbRounds + 1 ? 'Grand Final' : 'Grand Final Reset';
}

export function resolveRound(
  phaseType: string,
  poolName: string | null,
  matchLabel: string | null,
  bracket?: ExportBracketContext,
): string {
  if (phaseType === 'pool') {
    return 'Pools';
  }

  if (phaseType === 'double_elim') {
    return resolveDoubleElimRound(bracket, matchLabel);
  }

  if (phaseType === 'single_elim') {
    // Try to infer from match label (e.g. "F" = Gold Medal, "SF1" = Semi-final, "3rd" = Bronze)
    const label = (matchLabel ?? '').toUpperCase();
    // Bronze must be checked BEFORE Final (label may contain both "FINAL" and "BRONZE")
    if (label.includes('BRONZE') || label.includes('3RD') || label.includes('3RD PLACE')) {
      return 'Bronze Medal Match';
    }
    if (label.includes('FINAL') || label === 'F') return 'Gold Medal Match';
    if (label.includes('SF') || label.includes('SEMI')) return 'Semi-finals';
    if (label.includes('QF') || label.includes('QUARTER')) return 'Quarter-finals';
    if (label.includes('R16') || label.includes('TOP16') || label.includes('TOP 16'))
      return 'Top 16';
    if (label.includes('R32') || label.includes('TOP32') || label.includes('TOP 32'))
      return 'Top 32';
    if (label.includes('R64') || label.includes('TOP64') || label.includes('TOP 64'))
      return 'Top 64';
    // Fallback: use the label as-is
    return matchLabel ?? 'Elimination';
  }

  return poolName ?? matchLabel ?? 'Unknown';
}
