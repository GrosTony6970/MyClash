/**
 * End instant of a run of matches (a pool, or a bracket round) from their
 * START times alone — last start + the inferred per-match interval (the
 * MEDIAN gap between consecutive sorted starts). This gives a stable end
 * that matches what the grid shows, without needing a per-match duration
 * column. With fewer than two timed matches the interval is unknown, so we
 * fall back to `fallbackMin`.
 *
 * Pure: no I/O. Used to reconcile the referee board's pool end-time with
 * the schedule grid (both must agree).
 */
export function runEndIso(matchStartIsos: string[], fallbackMin = 5): string | null {
  const sorted = matchStartIsos
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const last = sorted[sorted.length - 1]!;
  if (sorted.length === 1) {
    return new Date(last + fallbackMin * 60_000).toISOString();
  }

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const medianGap =
    gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);

  return new Date(last + medianGap).toISOString();
}
