import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { readSparFighters, unknownSparFighter } from './spar-fighters';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const person = (id: string, clubs: unknown) => ({
  id,
  display_name: 'Probe Fighter',
  given_name: null,
  family_name: null,
  photo_url: null,
  clubs,
});

describe('readSparFighters', () => {
  it('reads the club name with the fighter, in one select', async () => {
    const supabase = mockSupabase({
      global_persons: { rows: [person(A, { name: 'Club A' })] },
    });
    await readSparFighters(supabase as never, [A]);
    expect(selectsFor(supabase.from, 'global_persons')).toEqual([
      'id, display_name, given_name, family_name, photo_url, clubs(name)',
    ]);
  });

  it('reads only the fighters asked for', async () => {
    const supabase = mockSupabase({
      global_persons: { rows: [person(A, null), person(B, null)] },
    });
    expect([...(await readSparFighters(supabase as never, [A])).keys()]).toEqual([A]);
    expect(filtersFor(supabase.from, 'global_persons', 'in')).toEqual([['id', [A]]]);
  });

  it('reads 250 fighters in pieces a request line can carry', async () => {
    const ids = Array.from({ length: 250 }, (_, n) => `id-${n}`);
    const supabase = mockSupabase({ global_persons: { rows: ids.map((id) => person(id, null)) } });
    expect((await readSparFighters(supabase as never, ids)).size).toBe(250);
    expect(
      filtersFor(supabase.from, 'global_persons', 'in').map((f) => (f[1] as string[]).length),
    ).toEqual([IN_LIST_MAX, 250 - IN_LIST_MAX]);
  });

  it('names the club, and reads no club as null, a wrong shape too', async () => {
    const supabase = mockSupabase({
      global_persons: {
        rows: [
          person(A, { name: 'Club A' }),
          person(B, null),
          person(C, [{ name: 'Club C' }]),
          person(D, { name: 42 }),
        ],
      },
    });
    const fighters = await readSparFighters(supabase as never, [A, B, C, D]);
    expect([A, B, C, D].map((id) => fighters.get(id)?.club)).toEqual(['Club A', null, null, null]);
  });

  it('gives a profile it did not find no club', () => {
    expect(unknownSparFighter(A)).toEqual({
      globalPersonId: A,
      name: '',
      photoUrl: null,
      club: null,
    });
  });
});
