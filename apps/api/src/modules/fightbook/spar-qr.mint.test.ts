import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  selectsFor,
  writesTo,
  type RecordedWrite,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { hashPassToken } from '../checkin/pass-token';
import { JULIE, MARC, NOW, qrWorld } from './spar-qr.fixtures';

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const code = (id: string, person: string, expires: number, created: number): SupabaseRow => ({
  id,
  global_person_id: person,
  token_hash: hashPassToken(id),
  expires_at: at(expires),
  created_at: at(created),
});

// Marc's codes: one past its end, an older one still live, the newest one on his screen. And
// Julie's code, newer than all of them, which Marc's mint must never touch.
const EXPIRED = code('c0000000-0000-4000-8000-000000000001', MARC, -1, -6);
const OLDER = code('c0000000-0000-4000-8000-000000000002', MARC, 1, -4);
const NEWEST = code('c0000000-0000-4000-8000-000000000003', MARC, 4, -1);
const JULIES = code('c0000000-0000-4000-8000-000000000004', JULIE, 5, 0);

/** The fixture rows a recorded delete leaves, by its `eq` and `neq` filters (no other is used). */
function survivors(rows: SupabaseRow[], write: RecordedWrite): unknown[] {
  const hit = (row: SupabaseRow) =>
    write.filters.every(({ method, args: [column, value] }) => {
      if (method === 'eq') return row[column as string] === value;
      if (method === 'neq') return row[column as string] !== value;
      throw new Error(`unexpected filter ${method}`);
    });
  return rows.filter((row) => !hit(row)).map((row) => row.id);
}

describe('SparQrService.mint', () => {
  it('keeps only my newest live code, adds the new one, and leaves another fighter’s alone', async () => {
    const codes = [EXPIRED, OLDER, NEWEST, JULIES];
    const { qr, supabase } = qrWorld({ codes });
    await qr.mint(MARC, NOW);
    const [cleanUp, added, ...more] = writesTo(supabase, 'fightbook_qr_codes');
    expect(more).toEqual([]);
    expect(cleanUp?.op).toBe('delete');
    expect(survivors(codes, cleanUp!)).toEqual([NEWEST.id, JULIES.id]);
    expect(cleanUp?.filters).toEqual([
      { method: 'eq', args: ['global_person_id', MARC] },
      { method: 'neq', args: ['id', NEWEST.id] },
    ]);
    expect(added?.op).toBe('insert');
    // The newest live code is read as mine, live, newest first: Julie's newer code and my
    // older one must each lose to it.
    expect(selectsFor(supabase.from, 'fightbook_qr_codes')[0]).toBe('id');
    expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'eq')[0]).toEqual([
      'global_person_id',
      MARC,
    ]);
    expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'gt')).toEqual([
      ['expires_at', NOW.toISOString()],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'order')).toEqual([
      ['created_at', { ascending: false }],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'limit')).toEqual([[1]]);
  });

  it('with no live code of mine, clears every code of mine', async () => {
    const codes = [EXPIRED, JULIES];
    const { qr, supabase } = qrWorld({ codes });
    await qr.mint(MARC, NOW);
    const [cleanUp] = writesTo(supabase, 'fightbook_qr_codes');
    expect(cleanUp?.filters).toEqual([{ method: 'eq', args: ['global_person_id', MARC] }]);
    expect(survivors(codes, cleanUp!)).toEqual([JULIES.id]);
  });

  it('answers fb: and the secret, stores only its hash, for five minutes', async () => {
    const { qr, supabase } = qrWorld();
    const answer = await qr.mint(MARC, NOW);
    expect(Object.keys(answer).sort()).toEqual(['code', 'expiresAt']);
    expect(answer.code).toMatch(/^fb:[A-Za-z0-9_-]{43}$/);
    expect(answer.expiresAt).toBe(at(5));
    const secret = answer.code.slice(3);
    const added = writesTo(supabase, 'fightbook_qr_codes').find((w) => w.op === 'insert');
    expect(added?.row).toEqual({
      token_hash: hashPassToken(secret),
      global_person_id: MARC,
      expires_at: at(5),
    });
    // No write carries the code or its secret: what the database holds cannot be shown as a QR.
    expect(supabase.writes.length).toBeGreaterThan(0);
    for (const write of supabase.writes) expect(JSON.stringify(write)).not.toContain(secret);
  });

  it('mints a new secret every time', async () => {
    const { qr } = qrWorld();
    const first = await qr.mint(MARC, NOW);
    const second = await qr.mint(MARC, NOW);
    expect(first.code).not.toBe(second.code);
  });
});
