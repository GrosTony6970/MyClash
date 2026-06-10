/**
 * Group pools into start-time sections for the public Pool List. Pools that
 * share an exact start instant (`startAt`) render under one section header
 * (DAY · TIME). Pools with no scheduled start collect in a trailing section
 * (`startAt: null`, shown as "Not scheduled"). Pure + dependency-free so it
 * unit-tests cleanly. End times are intentionally ignored — grouping is by
 * start only.
 */

export interface PoolSection<P> {
  startAt: string | null;
  pools: P[];
}

export function groupPoolsByStart<P extends { startAt: string | null }>(
  pools: P[],
): PoolSection<P>[] {
  const byStart = new Map<string, P[]>();
  const unscheduled: P[] = [];

  for (const pool of pools) {
    if (pool.startAt === null) {
      unscheduled.push(pool);
      continue;
    }
    const list = byStart.get(pool.startAt) ?? [];
    list.push(pool);
    byStart.set(pool.startAt, list);
  }

  const sections: PoolSection<P>[] = Array.from(byStart.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startAt, sectionPools]) => ({ startAt, pools: sectionPools }));

  if (unscheduled.length > 0) {
    sections.push({ startAt: null, pools: unscheduled });
  }

  return sections;
}
