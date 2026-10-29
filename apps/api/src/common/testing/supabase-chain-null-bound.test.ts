/**
 * A range filter on a null bound is refused, as the database refuses it: postgrest-js sends the text
 * `null`, which is no time and no number (the audited settings change, its plan's revision 18 fold
 * 5). The double used to drop every row instead, so a read that can only fail in production passed
 * as "nothing found" (`fighter-reconcile.ts` bounds `voided_at` by a Fighter's `out_since`, which is
 * null while they are in).
 */
import { describe, expect, it } from 'vitest';
import { supabaseFrom } from './supabase-chain';

const ROWS = [{ id: 'a', voided_at: '2026-10-21T10:00:00.000Z' }];

describe('a seeded table refuses a range filter on a null bound', () => {
  it.each(['gte', 'gt', 'lte', 'lt'] as const)(
    'answers %s on null with an error, resolved',
    async (op) => {
      const from = supabaseFrom({ match_forfeits: { rows: ROWS } });
      const answer = await from('match_forfeits').select('id')[op]('voided_at', null);
      expect(answer.data).toBeNull();
      expect(answer.error).toMatchObject({ code: '22007' });
    },
  );

  it('answers the error on maybeSingle and single too, and on an undefined bound', async () => {
    const from = supabaseFrom({ match_forfeits: { rows: ROWS } });
    const one = await from('match_forfeits').select('id').gte('voided_at', undefined).maybeSingle();
    const single = await from('match_forfeits').select('id').lt('voided_at', null).single();
    expect(one).toMatchObject({ data: null, error: { code: '22007' } });
    expect(single).toMatchObject({ data: null, error: { code: '22007' } });
  });

  it('keeps filtering a bound that is a value', async () => {
    const from = supabaseFrom({ match_forfeits: { rows: ROWS } });
    const answer = await from('match_forfeits')
      .select('id')
      .gte('voided_at', '2026-10-21T09:00:00.000Z');
    expect(answer).toMatchObject({ data: ROWS, error: null });
  });
});
