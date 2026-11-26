import { describe, expect, it } from 'vitest';
import { poolTableRows, type PoolTables } from './pool-table-rows';

const row = (over: Record<string, unknown>) => ({
  rank: 1,
  registrationId: 'reg-1',
  displayName: 'Ada',
  club: null,
  status: 'completed',
  stats: { wins: 2, score: 5 },
  ...over,
});

const tables = (rows: unknown[]) =>
  ({
    columns: [
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'wins', label: 'Wins', type: 'number' },
    ],
    pools: [{ poolId: 'p1', poolName: 'Pool A', status: 'in_progress', rows }],
  }) as unknown as PoolTables;

describe('poolTableRows', () => {
  it('keys the stats by the column label, in the ruleset column order', () => {
    const [pool] = poolTableRows(tables([row({})]));

    expect(pool).toMatchObject({ name: 'Pool A', status: 'in_progress' });
    expect(Object.entries(pool!.rows[0]!.stats)).toEqual([
      ['Score', 5],
      ['Wins', 2],
    ]);
  });

  it('names the club by its abbreviation, else its name, else null', () => {
    const [pool] = poolTableRows(
      tables([
        row({ club: { id: 'c', name: 'Alpha Club', abbreviation: 'ALP' } }),
        row({ club: { id: 'c', name: 'Alpha Club', abbreviation: null } }),
        row({ club: null }),
      ]),
    );

    expect(pool!.rows.map((r) => r.club)).toEqual(['ALP', 'Alpha Club', null]);
  });

  it('leaves out a column the row has no stat for', () => {
    const [pool] = poolTableRows(tables([row({ stats: { wins: 1 } })]));

    expect(pool!.rows[0]!.stats).toEqual({ Wins: 1 });
  });
});
