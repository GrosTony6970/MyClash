/**
 * Group bracket referee-board pools into round SECTIONS (Play-ins, Round of 16,
 * Quarter-finals, Semi-finals, Final, …) for the #referees tab, ordered
 * play-ins-first. The round is parsed from each pool's round-code `name`
 * (e.g. "LSW-B-QF-M1") via the shared `parseBracketRound` helper; codes that
 * don't parse fall into a trailing group whose token is null.
 *
 * Returns the round TOKEN, not a heading: the caller names it in the reader's
 * language through `roundColumnLabel`. `parseBracketRound`'s own label is English.
 *
 * Pure: no React, no I/O. Generic over any item carrying a round-code `name`.
 */
import { parseBracketRound } from '@myclash/schedule-core';

export function groupBracketPoolsBySection<T extends { name: string }>(
  pools: T[],
): Array<{ token: string | null; order: number; pools: T[] }> {
  const groups = new Map<string | null, { token: string | null; order: number; pools: T[] }>();
  for (const p of pools) {
    const round = parseBracketRound(p.name);
    const token = round?.token ?? null;
    const order = round?.order ?? Number.POSITIVE_INFINITY;
    const existing = groups.get(token);
    if (existing) existing.pools.push(p);
    else groups.set(token, { token, order, pools: [p] });
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
