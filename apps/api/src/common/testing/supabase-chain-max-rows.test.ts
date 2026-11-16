/**
 * A seeded table can cut every read at the server's own cap, `PGRST_DB_MAX_ROWS` (ruling 831). The
 * real PostgREST answers at most 1000 rows and says nothing; a double that answered every row let
 * a read that loses rows past the cap pass. Opt-in, so a seed without the cap answers as before.
 */
import { describe, expect, it } from 'vitest';
import { supabaseFrom } from './supabase-chain';

const ROWS = ['e', 'b', 'd', 'a', 'c'].map((id) => ({ id }));
const ids = (answer: { data: unknown }) => (answer.data as Array<{ id: string }>).map((r) => r.id);

describe('a seeded table with maxRows', () => {
  it('answers at most maxRows rows, in seed order, when the query asks no limit', async () => {
    const from = supabaseFrom({ bouts: { rows: ROWS, maxRows: 2 } });
    expect(ids(await from('bouts').select('id'))).toEqual(['e', 'b']);
  });

  it('answers the smaller of the limit and maxRows', async () => {
    const from = supabaseFrom({ bouts: { rows: ROWS, maxRows: 2 } });
    expect(ids(await from('bouts').select('id').limit(10))).toEqual(['e', 'b']);
    expect(ids(await from('bouts').select('id').limit(1))).toEqual(['e']);
  });

  it('cuts after the filters and the order, as the server does', async () => {
    const from = supabaseFrom({ bouts: { rows: ROWS, maxRows: 2 } });
    const answer = await from('bouts').select('id').gt('id', 'a').order('id').limit(1000);
    expect(ids(answer)).toEqual(['b', 'c']);
  });

  it('counts every row that matched, not the cut page', async () => {
    const from = supabaseFrom({ bouts: { rows: ROWS, maxRows: 2 } });
    const answer = await from('bouts').select('id', { count: 'exact' });
    expect(answer).toMatchObject({ count: 5 });
    expect(ids(answer)).toHaveLength(2);
  });

  it('answers every row when the seed has no maxRows', async () => {
    const from = supabaseFrom({ bouts: { rows: ROWS } });
    expect(ids(await from('bouts').select('id'))).toHaveLength(5);
  });
});
