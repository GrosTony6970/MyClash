import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { MatchAutoLockService } from './match-auto-lock.service';

/**
 * The auto-lock reads every row it needs, page after page, and only what can lock (rulings 831,
 * 841). PostgREST cuts one read at 1000 rows and says nothing: the double does too here
 * (`maxRows`), so a read that stops at the cut loses rows as it would in production.
 */
const DONE_AT = '2026-05-16T10:00:00.000Z';
const NOW = new Date('2026-05-16T10:20:00.000Z');
const id4 = (n: number) => String(n).padStart(4, '0');

type Row = Record<string, unknown>;

function bout(id: string, phase: string, pool: string | null, extra: Row = {}): Row {
  return {
    id,
    phase_id: phase,
    pool_id: pool,
    status: 'completed',
    ended_at: DONE_AT,
    updated_at: DONE_AT,
    locked_at: null,
    ...extra,
  };
}

/** One running Event, one Tournament with the default lock settings, and the phases given. */
function world(phases: Row[], matches: Row[], maxRows = 1000, extra: Record<string, Row[]> = {}) {
  return mockSupabase({
    events: { rows: [{ id: 'e1', status: 'running' }, ...(extra['events'] ?? [])], maxRows },
    tournaments: {
      rows: [{ id: 't1', event_id: 'e1', lock_config_json: {} }, ...(extra['tournaments'] ?? [])],
      maxRows,
    },
    phases: { rows: phases, maxRows },
    matches: { rows: matches, maxRows },
  });
}

describe('MatchAutoLockService: the paged, narrow read', () => {
  const lockMatch = vi.fn();
  const locked = () => lockMatch.mock.calls.map(([id]) => id as string);
  const scanner = (db: { service: unknown }) =>
    new MatchAutoLockService(db as never, { lockMatch } as never);

  beforeEach(() => {
    lockMatch.mockReset();
    lockMatch.mockImplementation(async (id: string) => ({ id }));
  });

  it('locks every finished Pool of 1,200 bouts, past the 1000-row cut, and not the one still running', async () => {
    // 100 Pools of 12. Pool 84 is m-0997..m-1008: it crosses row 1000, and m-1008 still runs.
    const matches = Array.from({ length: 1200 }, (_, i) =>
      bout(`m-${id4(i + 1)}`, 'p1', `pool-${id4(Math.floor(i / 12) + 1)}`),
    );
    matches[1007] = bout('m-1008', 'p1', 'pool-0084', { status: 'running', ended_at: null });
    // Stored out of id order, as a heap is: only the read's `order('id')` makes the pages right.
    // 7919 is prime to 1200, so this visits every index once.
    const stored = matches.map((_, i) => matches[(i * 7919) % 1200]!);
    const db = world([{ id: 'p1', tournament_id: 't1', type: 'pool' }], stored);

    expect(await scanner(db).runOnce(NOW)).toBe(1188);
    expect(new Set(locked()).size).toBe(1188);
    expect(locked().filter((id) => id >= 'm-0997' && id <= 'm-1008')).toEqual([]);
    expect(locked()).toContain('m-1200');
    // Every read asks by key: ordered by id, page after page.
    for (const table of ['events', 'tournaments', 'phases', 'matches']) {
      const orders = filtersFor(db.from, table, 'order');
      expect(orders.length, table).toBeGreaterThan(0);
      expect(orders.map(([column]) => column)).toEqual(orders.map(() => 'id'));
    }
  });

  it('asks only for the groups that can lock: not a locked Pool, not a running one', async () => {
    const running = { status: 'running', ended_at: null };
    const db = world(
      [{ id: 'p1', tournament_id: 't1', type: 'pool' }],
      [
        bout('m1', 'p1', 'done'),
        bout('m2', 'p1', 'locked', { locked_at: DONE_AT }),
        bout('m3', 'p1', 'running', running),
      ],
    );
    expect(await scanner(db).runOnce(NOW)).toBe(1);
    const pools = filtersFor(db.from, 'matches', 'in').flatMap(([column, values]) =>
      column === 'pool_id' ? (values as string[]) : [],
    );
    expect([...new Set(pools)]).toEqual(['done']);
  });

  it('reads only the columns each step needs, and every column the decision reads', async () => {
    const db = world([{ id: 'p1', tournament_id: 't1', type: 'pool' }], [bout('m1', 'p1', 'a')]);
    await scanner(db).runOnce(NOW);
    const asked = (table: string) => new Set(selectsFor(db.from, table));
    expect(asked('events')).toEqual(new Set(['id, status']));
    expect(asked('tournaments')).toEqual(new Set(['id, lock_config_json, event_id']));
    expect(asked('phases')).toEqual(new Set(['id, tournament_id, type']));
    // The candidates' read, then the groups' read: the wait reads ended_at and updated_at.
    expect(asked('matches')).toEqual(
      new Set([
        'id, phase_id, pool_id',
        'id, phase_id, pool_id, status, ended_at, updated_at, locked_at',
      ]),
    );
  });

  it('locks a Bracket or a Swiss phase only once all its bouts are done, a pool id or not', async () => {
    const phases = [
      { id: 'se', tournament_id: 't1', type: 'single_elim' },
      { id: 'sw', tournament_id: 't1', type: 'swiss' },
    ];
    const running = { status: 'running', ended_at: null };
    const open = world(phases, [
      bout('se-1', 'se', null),
      bout('se-2', 'se', null, running),
      bout('sw-1', 'sw', 'x'),
      bout('sw-2', 'sw', 'y', running),
    ]);
    expect(await scanner(open).runOnce(NOW)).toBe(0);

    const done = world(phases, [
      bout('se-1', 'se', null),
      bout('se-2', 'se', null),
      bout('sw-1', 'sw', 'x'),
      bout('sw-2', 'sw', 'y'),
    ]);
    expect(await scanner(done).runOnce(NOW)).toBe(4);
  });

  it('does not lock a Pool whose only open bout is locked and running again', async () => {
    const db = world(
      [{ id: 'p1', tournament_id: 't1', type: 'pool' }],
      [
        bout('m1', 'p1', 'a'),
        bout('m2', 'p1', 'a', { status: 'running', ended_at: null, locked_at: DONE_AT }),
      ],
    );
    expect(await scanner(db).runOnce(NOW)).toBe(0);
  });

  it('waits the whole delay from a locked bout’s last write', async () => {
    const fiveMinutesAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const db = world(
      [{ id: 'p1', tournament_id: 't1', type: 'pool' }],
      [
        bout('m1', 'p1', 'a'),
        bout('m2', 'p1', 'a', { locked_at: fiveMinutesAgo, updated_at: fiveMinutesAgo }),
      ],
    );
    expect(await scanner(db).runOnce(NOW)).toBe(0);
  });

  it('never reads the bouts of an Event that is over (ruling 841)', async () => {
    const db = world(
      [
        { id: 'p1', tournament_id: 't1', type: 'pool' },
        { id: 'p2', tournament_id: 't2', type: 'pool' },
        { id: 'p3', tournament_id: 't3', type: 'pool' },
      ],
      [bout('m1', 'p1', 'a'), bout('m2', 'p2', 'b'), bout('m3', 'p3', 'c')],
      1000,
      {
        events: [
          { id: 'e2', status: 'completed' },
          { id: 'e3', status: 'archived' },
        ],
        tournaments: [
          { id: 't2', event_id: 'e2', lock_config_json: {} },
          { id: 't3', event_id: 'e3', lock_config_json: {} },
        ],
      },
    );
    expect(await scanner(db).runOnce(NOW)).toBe(1);
    expect(locked()).toEqual(['m1']);
    // Each list is asked once per page: the second, empty page asks it again.
    const asked = (table: string, column: string) => [
      ...new Set(
        filtersFor(db.from, table, 'in').flatMap(([c, values]) => (c === column ? values : [])),
      ),
    ];
    expect(asked('tournaments', 'event_id')).toEqual(['e1']);
    expect(asked('phases', 'tournament_id')).toEqual(['t1']);
    expect(asked('matches', 'phase_id')).toEqual(['p1']);
  });

  it('asks for 250 Pools in pieces of IN_LIST_MAX, each Pool once', async () => {
    const matches = Array.from({ length: 250 }, (_, i) => [
      bout(`m-${id4(i)}-a`, 'p1', `pool-${id4(i)}`),
      bout(`m-${id4(i)}-b`, 'p1', `pool-${id4(i)}`),
    ]).flat();
    const db = world([{ id: 'p1', tournament_id: 't1', type: 'pool' }], matches);

    expect(await scanner(db).runOnce(NOW)).toBe(500);
    const lists = filtersFor(db.from, 'matches', 'in')
      .filter(([column]) => column === 'pool_id')
      .map(([, values]) => values as string[]);
    // Page by page: a piece is asked again for its next page, never in another piece.
    const pieces = [...new Map(lists.map((list) => [list.join(), list])).values()];
    expect(pieces.map((list) => list.length)).toEqual([IN_LIST_MAX, 50]);
    expect(new Set(pieces.flat()).size).toBe(250);
    // Each Pool read within its own phase: a pool id never joins two phases.
    expect(filtersFor(db.from, 'matches', 'eq')).toContainEqual(['phase_id', 'p1']);
  });

  it('a pool id never joins two phases: each Pool is read within its own phase', async () => {
    const db = world(
      [
        { id: 'p1', tournament_id: 't1', type: 'pool' },
        { id: 'p2', tournament_id: 't1', type: 'pool' },
      ],
      [
        bout('m1', 'p1', 'a'),
        bout('m2', 'p1', 'a'),
        bout('m3', 'p2', 'a'),
        bout('m4', 'p2', 'a', { status: 'running', ended_at: null }),
      ],
    );
    expect(await scanner(db).runOnce(NOW)).toBe(2);
    expect(locked()).toEqual(['m1', 'm2']);
  });

  it('reads the bouts with no Pool in a pool phase as one group of their own', async () => {
    const db = world(
      [{ id: 'p1', tournament_id: 't1', type: 'pool' }],
      [
        bout('m1', 'p1', null),
        bout('m2', 'p1', null),
        bout('m3', 'p1', 'a'),
        bout('m4', 'p1', 'b', { status: 'running', ended_at: null }),
      ],
    );
    // Each bout once: the no-Pool read must not bring back the Pools' bouts.
    expect(await scanner(db).runOnce(NOW)).toBe(3);
    expect(locked()).toEqual(['m1', 'm2', 'm3']);
  });

  it('a bout added behind the cursor between two pages waits for the next scan', async () => {
    // Pages of 3: the candidates' read takes two pages and a third, empty one.
    const rows: Row[] = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'].map((id) => bout(id, 'p1', 'a'));
    const db = world([{ id: 'p1', tournament_id: 't1', type: 'pool' }], rows, 3);
    let reads = 0;
    const from = vi.fn((table: string) => {
      // Before the candidates' page 2: a finished bout of another Pool, its id behind the cursor.
      if (table === 'matches' && ++reads === 2) rows.unshift(bout('a-0', 'p1', 'b'));
      return db.from(table);
    });
    const service = scanner({ service: { from } });

    expect(await service.runOnce(NOW)).toBe(5);
    expect(locked()).not.toContain('a-0');
    // Every existing row once, none skipped.
    expect(locked()).toEqual(['a-1', 'a-2', 'a-3', 'a-4', 'a-5']);

    lockMatch.mockClear();
    await service.runOnce(NOW);
    expect(locked()).toContain('a-0');
  });

  it('a module that closes during the reads reads no further page and locks nothing', async () => {
    const rows = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7'].map((id) => bout(id, 'p1', 'a'));
    const db = world([{ id: 'p1', tournament_id: 't1', type: 'pool' }], rows, 3);
    let reads = 0;
    let service: MatchAutoLockService | null = null;
    const from = vi.fn((table: string) => {
      // The stop lands while the candidates' page 2 is read.
      if (table === 'matches' && ++reads === 2) service?.onModuleDestroy();
      return db.from(table);
    });
    service = scanner({ service: { from } });

    expect(await service.runOnce(NOW)).toBe(0);
    expect(reads).toBe(2);
    expect(lockMatch).not.toHaveBeenCalled();
  });
});
