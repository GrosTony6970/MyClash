import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type ChainResult,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { readOwnSparLine, readPublicSparLine } from './spar-public-line';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c0d4b63-8e6a-4b68-8a66-2c2c4a6d3b02';
const LEA = '2d1e5c74-9f7b-4c79-9b77-3d3d5b7e4c03';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const OLD = '2026-11-09T21:59:59.000Z'; // before now - 48 h
const RECENT = '2026-11-11T21:59:59.000Z'; // after now - 48 h

const spar = (extra: SupabaseRow): SupabaseRow => ({
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  status: 'done',
  expires_at: OLD,
  ...extra,
});

interface Setup {
  enabled?: boolean;
  showStars?: boolean;
  star?: ChainResult;
  rows?: SupabaseRow[];
}

function setup({ enabled = true, showStars = true, star, rows }: Setup = {}) {
  return mockSupabase(
    {
      global_persons: {
        rows: [
          { id: MARC, fightbook_enabled: enabled, fightbook_show_stars: showStars },
          { id: LEA, fightbook_enabled: false, fightbook_show_stars: true },
        ],
      },
      spar_requests: {
        rows: rows ?? [
          spar({}), // Marc asked: counts
          spar({ asker_global_person_id: JULIE, receiver_global_person_id: MARC }), // Marc received: counts
          spar({ expires_at: RECENT }), // still inside the undo window: excluded
          spar({ status: 'agreed' }), // not marked: excluded
          spar({ asker_global_person_id: JULIE, receiver_global_person_id: LEA }), // Marc is not in it
        ],
      },
    },
    {
      fightbook_star_line: () => star ?? { data: { average: 4.5, count: 2 }, error: null },
    },
  );
}

describe('readPublicSparLine', () => {
  it('answers null with FightBook off, and reads no spar and calls no star line', async () => {
    const db = setup({ enabled: false });
    expect(await readPublicSparLine(db.service as never, MARC, NOW)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from.mock.calls.map(([table]) => table)).toEqual(['global_persons']);
  });

  it('reads its own two switches by id', async () => {
    const db = setup();
    await readPublicSparLine(db.service as never, MARC, NOW);
    expect(selectsFor(db.from, 'global_persons')).toEqual([
      'fightbook_enabled, fightbook_show_stars',
    ]);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
  });

  it('counts done spars on either side past the 48 h grace, and nothing else', async () => {
    const db = setup({ showStars: false });
    const line = await readPublicSparLine(db.service as never, MARC, NOW);
    expect(line).toEqual({ sparred: 2, stars: null });
    expect(selectsFor(db.from, 'spar_requests')).toEqual(['id']);
    expect(filtersFor(db.from, 'spar_requests', 'eq')).toEqual([['status', 'done']]);
    expect(filtersFor(db.from, 'spar_requests', 'lte')).toEqual([
      ['expires_at', '2026-11-10T12:00:00.000Z'],
    ]);
    expect(filtersFor(db.from, 'spar_requests', 'or')).toEqual([
      [`asker_global_person_id.eq.${MARC},receiver_global_person_id.eq.${MARC}`],
    ]);
  });

  it('calls no star line while the stars switch is off', async () => {
    const db = setup({ showStars: false });
    expect((await readPublicSparLine(db.service as never, MARC, NOW))?.stars).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('shows the stars from the first review once switched on (689)', async () => {
    const db = setup({ star: { data: { average: 5, count: 1 }, error: null } });
    const line = await readPublicSparLine(db.service as never, MARC, NOW);
    expect(line).toEqual({ sparred: 2, stars: { average: 5, count: 1 } });
    const [name, args] = db.rpc.mock.calls[0]!;
    expect(name).toBe('fightbook_star_line');
    expect(Object.keys(args!)).toEqual(lastFunctionParams('fightbook_star_line'));
    expect(args).toEqual({ p_subject: MARC });
  });

  it('shows no stars at a count of 0, never "0.0 (0)" (Review Focus 3)', async () => {
    const db = setup({ star: { data: { average: null, count: 0 }, error: null } });
    expect(await readPublicSparLine(db.service as never, MARC, NOW)).toEqual({
      sparred: 2,
      stars: null,
    });
  });

  describe('when a read fails, the profile still renders', () => {
    const boom = { data: null, error: { message: 'boom' } };
    const failing = (failure: 'switch' | 'count' | 'star') =>
      mockSupabase(
        {
          global_persons:
            failure === 'switch'
              ? boom
              : { data: { fightbook_enabled: true, fightbook_show_stars: true }, error: null },
          spar_requests: failure === 'count' ? boom : { data: [], error: null, count: 2 },
        },
        { fightbook_star_line: () => (failure === 'star' ? boom : { data: null, error: null }) },
      );

    it.each([
      ['switch', 'switch read failed', ['global_persons'], 0],
      ['count', 'sparred count failed', ['global_persons', 'spar_requests'], 0],
      ['star', 'star line read failed', ['global_persons', 'spar_requests'], 1],
    ] as const)(
      'a failed %s read answers null and logs a warning',
      async (failure, message, tables, rpcCalls) => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const db = failing(failure);
        expect(await readPublicSparLine(db.service as never, MARC, NOW)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toContain(message);
        expect(String(warn.mock.calls[0]![0])).not.toContain(MARC);
        // Nothing after the failed step is attempted.
        expect(db.from.mock.calls.map(([table]) => table)).toEqual(tables);
        expect(db.rpc.mock.calls.length).toBe(rpcCalls);
        warn.mockRestore();
      },
    );

    it('the own line still throws', async () => {
      await expect(readOwnSparLine(failing('star').service as never, MARC, NOW)).rejects.toThrow(
        /boom/u,
      );
    });
  });
});

describe('readOwnSparLine', () => {
  it('gives the stars from the first review, with no look at any switch', async () => {
    const db = setup({ enabled: false, showStars: false });
    const line = await readOwnSparLine(db.service as never, MARC, NOW);
    expect(line).toEqual({ sparred: 2, stars: { average: 4.5, count: 2 } });
    expect(db.from.mock.calls.map(([table]) => table)).toEqual(['spar_requests']);
    expect(db.rpc.mock.calls[0]![1]).toEqual({ p_subject: MARC });
  });

  it('has no stars before the first review', async () => {
    const db = setup({ star: { data: { average: null, count: 0 }, error: null } });
    expect((await readOwnSparLine(db.service as never, MARC, NOW)).stars).toBeNull();
  });
});
