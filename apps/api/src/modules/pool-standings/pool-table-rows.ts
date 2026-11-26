import type { PoolStandingsResponse } from './pool-standings.service';

/** The by-pool branch of the public standings read: one table per Pool. */
export type PoolTables = Extract<PoolStandingsResponse, { pools: unknown }>;

export interface PoolTableRows {
  name: string;
  status: string;
  rows: {
    rank: number;
    name: string;
    club: string | null;
    /** The ruleset's own columns by their header label (Wins, Doubles, Score...), in column order. */
    stats: Record<string, number | string>;
  }[];
}

/**
 * The public pool tables as plain rows, without registration or Pool ids. One owner, so the
 * Claude tool and the query panel show the table the public Tournament page ranks by the ruleset.
 */
export function poolTableRows(tables: PoolTables): PoolTableRows[] {
  return tables.pools.map((pool) => ({
    name: pool.poolName,
    status: pool.status,
    rows: pool.rows.map((row) => ({
      rank: row.rank,
      name: row.displayName,
      club: row.club ? (row.club.abbreviation ?? row.club.name) : null,
      stats: Object.fromEntries(
        tables.columns.flatMap((c) => (c.key in row.stats ? [[c.label, row.stats[c.key]!]] : [])),
      ),
    })),
  }));
}
