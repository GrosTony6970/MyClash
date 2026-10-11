import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { countAtStart } from './start-count';

/**
 * A bout that starts has its score counted (operator, 2026-10-11): a bout that
 * counts down reads cap to cap on every screen from its Start, not 0 - 0 until
 * the first hit. The count is `ScoringService.recomputeMatchScore`; this is
 * WHEN it runs, and the proof that it landed.
 *
 * The test double does not keep a write, so a row "after the count" is the
 * second answer of the `matches` queue.
 */
const BOUT = 'm1';
const row = (status: string, red: number, blue: number, event = 'running') => ({
  data: {
    id: BOUT,
    status,
    red_score: red,
    blue_score: blue,
    phases: { tournaments: { events: { status: event } } },
  },
  error: null,
});
const ROW = 'id, status, red_score, blue_score, phases(tournaments(events(status)))';
const NOTHING = { rows: [] };
const A_HIT = { rows: [{ id: 'e1', match_id: BOUT, voided: false }] };
const FAULT = { data: null, error: { message: 'down' } };

function setup(seed: {
  matches: unknown;
  exchanges?: unknown;
  cards?: unknown;
  counted?: { redScore: number; blueScore: number };
}) {
  const db = mockSupabase({
    matches: seed.matches,
    exchanges: seed.exchanges ?? NOTHING,
    match_penalties: seed.cards ?? NOTHING,
  } as never);
  const recompute = vi.fn().mockResolvedValue(seed.counted ?? { redScore: 5, blueScore: 5 });
  return { db, recompute, count: () => countAtStart({ db: db as never, recompute }, BOUT) };
}

describe('countAtStart — when a Start counts the score', () => {
  it('counts a bout in play at 0 - 0 with nothing on its sheet', async () => {
    const { db, recompute, count } = setup({
      matches: [row('running', 0, 0), row('running', 5, 5)],
    });

    await expect(count()).resolves.toBeUndefined();

    expect(recompute.mock.calls).toEqual([[BOUT]]);
    // Each read names its bout, and the sheet is the live rows only.
    // The row is read before the count and after it.
    expect(selectsFor(db.from, 'matches')).toEqual([ROW, ROW]);
    expect(filtersFor(db.from, 'matches', 'eq')).toEqual(Array(2).fill(['id', BOUT]));
    for (const table of ['exchanges', 'match_penalties']) {
      expect(selectsFor(db.from, table)).toEqual(['id']);
      expect(filtersFor(db.from, table, 'eq')).toEqual([
        ['match_id', BOUT],
        ['voided', false],
      ]);
    }
  });

  it('counts a bout the clock has halted since, too', async () => {
    const { recompute, count } = setup({
      matches: [row('paused', 0, 0), row('paused', 5, 5)],
    });

    await count();

    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'scheduled', 'voided'])(
    'counts nothing on a bout that is not in play (%s)',
    async (status) => {
      // The clock answers a Start it already holds whatever happened since: a
      // bout reset to "scheduled" must not get a score from that answer.
      const { recompute, count } = setup({ matches: row(status, 0, 0) });

      await count();

      expect(recompute).not.toHaveBeenCalled();
    },
  );

  it.each(['completed', 'archived'])(
    'counts nothing on an Event that is over (%s): its rows are frozen',
    async (event) => {
      const { recompute, count } = setup({ matches: row('running', 0, 0, event) });

      await count();

      expect(recompute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['red', 5, 0],
    ['blue', 0, 3],
  ])('counts nothing on a bout whose row already holds a score (%s)', async (_side, red, blue) => {
    const { recompute, count } = setup({ matches: row('running', red, blue) });

    await count();

    expect(recompute).not.toHaveBeenCalled();
  });

  it('counts nothing over a sheet that holds a hit: that bout was fought', async () => {
    // A bout the doubles limit ended at 0 - 0, put back in play. Counted again
    // here, it would be completed again before the referee can correct it.
    const { recompute, count } = setup({ matches: row('running', 0, 0), exchanges: A_HIT });

    await count();

    expect(recompute).not.toHaveBeenCalled();
  });

  it('counts nothing over a sheet that holds a card', async () => {
    const { recompute, count } = setup({
      matches: row('running', 0, 0),
      cards: { rows: [{ id: 'c1', match_id: BOUT, voided: false }] },
    });

    await count();

    expect(recompute).not.toHaveBeenCalled();
  });

  it('does not take a voided hit, or another bout’s hit, for a hit of this sheet', async () => {
    const { recompute, count } = setup({
      matches: [row('running', 0, 0), row('running', 5, 5)],
      exchanges: {
        rows: [
          { id: 'e1', match_id: BOUT, voided: true },
          { id: 'e2', match_id: 'm2', voided: false },
        ],
      },
    });

    await count();

    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('counts nothing for a bout it does not find', async () => {
    const { recompute, count } = setup({ matches: { data: null, error: null } });

    await count();

    expect(recompute).not.toHaveBeenCalled();
  });
});

describe('countAtStart — the count must land', () => {
  it('throws when the row does not hold the counted score and the sheet is still empty', async () => {
    // The write of the row failed in silence: the row is still 0 - 0.
    const { count } = setup({ matches: row('running', 0, 0) });

    await expect(count()).rejects.toThrow('was not counted at its Start');
  });

  it('throws when the bout is gone after the count', async () => {
    const { count } = setup({
      matches: [row('running', 0, 0), { data: null, error: null }],
    });

    await expect(count()).rejects.toThrow('was not counted at its Start');
  });

  it('passes when a hit landed meanwhile: its own count moved the row', async () => {
    const db = mockSupabase({
      matches: [row('running', 0, 0), row('running', 5, 3)],
      // Empty at the first read, one hit at the second.
      exchanges: [
        { data: [], error: null },
        { data: [{ id: 'e1' }], error: null },
      ],
      match_penalties: NOTHING,
    } as never);
    const recompute = vi.fn().mockResolvedValue({ redScore: 5, blueScore: 5 });

    await expect(countAtStart({ db: db as never, recompute }, BOUT)).resolves.toBeUndefined();
  });

  it('is at peace with a bout that counts up: 0 - 0 counted is 0 - 0 on the row', async () => {
    const { recompute, count } = setup({
      matches: row('running', 0, 0),
      counted: { redScore: 0, blueScore: 0 },
    });

    await expect(count()).resolves.toBeUndefined();
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it.each(['matches', 'exchanges', 'match_penalties'])(
    'lets a failed read of %s through: an unread bout is not an empty one',
    async (table) => {
      const seed = { matches: row('running', 0, 0) as unknown, exchanges: NOTHING as unknown };
      const tables = { ...seed, match_penalties: NOTHING as unknown, [table]: FAULT };
      const db = mockSupabase(tables as never);
      const recompute = vi.fn();

      await expect(countAtStart({ db: db as never, recompute }, BOUT)).rejects.toThrow('down');
      expect(recompute).not.toHaveBeenCalled();
    },
  );

  it('lets a failed count through', async () => {
    const { db } = setup({ matches: row('running', 0, 0) });
    const recompute = vi.fn().mockRejectedValue(new Error('Could not read the sheet'));

    await expect(countAtStart({ db: db as never, recompute }, BOUT)).rejects.toThrow(
      'Could not read the sheet',
    );
  });
});
