/**
 * Group bracket referee-board pools into round SECTIONS (Play-ins, Round of 16,
 * Quarter-finals, Semi-finals, Final, …) for the #referees tab, ordered
 * play-ins-first. The round is parsed from each pool's round-code `name`
 * (e.g. "LSW-B-QF-M1") via the shared `parseBracketRound` helper; codes that
 * don't parse fall into a trailing "Other" group.
 *
 * Pure: no React, no I/O. Generic over any item carrying a round-code `name`.
 */
import { parseBracketRound } from '../../schedule/bracket-round-group';

export function groupBracketPoolsBySection<T extends { name: string }>(
  pools: T[],
): Array<{ label: string; order: number; pools: T[] }> {
  const groups = new Map<string, { label: string; order: number; pools: T[] }>();
  for (const p of pools) {
    const round = parseBracketRound(p.name);
    const label = round?.label ?? 'Other';
    const order = round?.order ?? Number.POSITIVE_INFINITY;
    const existing = groups.get(label);
    if (existing) existing.pools.push(p);
    else groups.set(label, { label, order, pools: [p] });
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
