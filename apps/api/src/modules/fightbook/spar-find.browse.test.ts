import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { SparFindService } from './spar-find.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const OFF = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
const UNCLAIMED = '4f107e96-1b9d-4e9b-9d99-5f5d7d906e45';
const MERGED = '50218fa7-2cae-4fac-8eaa-606e8ea17f56';
const BLOCKED = '8354bcda-5fd1-42df-91dd-9391b1d4a289';
const BLOCKER = '9465cdeb-60e2-43e0-a2ee-a4a2c2e5b39a';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const WEAPON = 'a1000000-0000-4000-8000-000000000001';

const fighter = (
  id: string,
  family: string,
  given: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  display_name: `${given} ${family}`,
  given_name: given,
  family_name: family,
  photo_url: null,
  clubs: null,
  claimed_by_user_id: ACCOUNT,
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  ...over,
});
const block = (blocker: string, blocked: string) => ({
  blocker_global_person_id: blocker,
  blocked_global_person_id: blocked,
});
const filler = (n: number) => `5d0c1f6e-2a3b-4c5d-8e9f-${String(n).padStart(12, '0')}`;
const fillers = (count: number) =>
  Array.from({ length: count }, (_, n) => fighter(filler(n), 'Fill', String(n).padStart(3, '0')));

// "Aaa" would sort first: each of these three rows is left out by the FightBook filter alone.
const base = [
  fighter(MARC, 'Self', 'Marc'),
  fighter(JULIE, 'Alpha', 'Julie'),
  fighter(BLOCKER, 'Bravo', 'Hugo'),
  fighter(BLOCKED, 'Charlie', 'Paul'),
  fighter(OFF, 'Aaa', 'Off', { fightbook_enabled: false }),
  fighter(UNCLAIMED, 'Aaa', 'Unclaimed', { claimed_by_user_id: null }),
  fighter(MERGED, 'Aaa', 'Merged', { merged_into_id: JULIE }),
];

/** By default I blocked Paul, and Hugo blocked me (which must change nothing I see, 672). */
function service({
  rows = base,
  blocks = [block(MARC, BLOCKED), block(BLOCKER, MARC)],
}: { rows?: Array<Record<string, unknown>>; blocks?: Array<Record<string, string>> } = {}) {
  const supabase = mockSupabase({
    global_persons: { rows },
    fightbook_blocks: { rows: blocks },
    fighter_weapons: {
      rows: [
        {
          global_person_id: JULIE,
          favorite: true,
          sort_order: 0,
          weapon_catalog: { name: 'Sabre' },
        },
      ],
    },
  });
  return { find: new SparFindService(supabase as never, {} as never), supabase };
}

const names = (page: { items: Array<{ fighter: { name: string } }> }) =>
  page.items.map((card) => card.fighter.name);

describe('SparFindService.browse', () => {
  it('lists every FightBook user but me, by name, with their cards', async () => {
    const { find } = service();
    const page = await find.browse(MARC, undefined, undefined, 0);
    expect(page).toEqual({
      items: [
        {
          fighter: { globalPersonId: JULIE, name: 'Julie Alpha', photoUrl: null, club: null },
          weapons: ['Sabre'],
        },
        {
          fighter: { globalPersonId: BLOCKER, name: 'Hugo Bravo', photoUrl: null, club: null },
          weapons: [],
        },
      ],
      more: false,
    });
  });

  it('reads FightBook users only, never me, in one paged and ordered read', async () => {
    const { find, supabase } = service();
    await find.browse(MARC, undefined, undefined, 1);
    expect(selectsFor(supabase.from, 'global_persons')[0]).toBe('id');
    expect(filtersFor(supabase.from, 'global_persons', 'is')).toEqual([
      ['deleted_at', null],
      ['merged_into_id', null],
      ['account_deleted_at', null],
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([
      ['fightbook_enabled', true],
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'not')).toContainEqual([
      'claimed_by_user_id',
      'is',
      null,
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'neq')).toEqual([['id', MARC]]);
    expect(filtersFor(supabase.from, 'global_persons', 'order')).toEqual([
      ['family_name'],
      ['given_name'],
      ['id'],
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'range')).toEqual([[20, 40]]);
  });

  it('answers 20 and says more when a 21st row came back', async () => {
    const { find } = service({ rows: fillers(21) });
    const page = await find.browse(MARC, undefined, undefined, 0);
    expect(page.items).toHaveLength(20);
    expect(page.more).toBe(true);
    expect(names(page)[19]).toBe('019 Fill');
  });

  it('answers 20 and no more when 20 came back', async () => {
    const page = await service({ rows: fillers(20) }).find.browse(MARC, undefined, undefined, 0);
    expect(page.items).toHaveLength(20);
    expect(page.more).toBe(false);
  });

  it('reads the next page from row 20', async () => {
    const page = await service({ rows: fillers(25) }).find.browse(MARC, undefined, undefined, 1);
    expect(names(page)).toEqual(['020 Fill', '021 Fill', '022 Fill', '023 Fill', '024 Fill']);
    expect(page.more).toBe(false);
  });
});

describe('SparFindService.browse, a name', () => {
  it.each([undefined, ' a ', '%%', '(('])('reads everyone for %j: no name filter', async (q) => {
    const { find, supabase } = service();
    expect(names(await find.browse(MARC, q, undefined, 0))).toEqual(['Julie Alpha', 'Hugo Bravo']);
    expect(filtersFor(supabase.from, 'global_persons', 'or')).toEqual([]);
  });

  it('narrows by given, family or display name, the value sanitized', async () => {
    const { find, supabase } = service();
    await find.browse(MARC, 'Ma,rc', undefined, 0);
    expect(filtersFor(supabase.from, 'global_persons', 'or')).toEqual([
      ['given_name.ilike.%Marc%,family_name.ilike.%Marc%,display_name.ilike.%Marc%'],
    ]);
  });

  it('strips the ilike wildcards from what the fighter typed, and finds by name', async () => {
    const { find, supabase } = service();
    expect(names(await find.browse(MARC, ' %Ju_lie% ', undefined, 0))).toEqual(['Julie Alpha']);
    expect(filtersFor(supabase.from, 'global_persons', 'or')).toEqual([
      ['given_name.ilike.%Julie%,family_name.ilike.%Julie%,display_name.ilike.%Julie%'],
    ]);
  });
});

describe('SparFindService.browse, a weapon', () => {
  // The double cannot follow the embed: the probe on a real PostgREST is the behaviour test.
  it('filters on the inner-joined embed when a weapon is set, and not otherwise', async () => {
    const withWeapon = service();
    await withWeapon.find.browse(MARC, undefined, WEAPON, 0);
    expect(selectsFor(withWeapon.supabase.from, 'global_persons')[0]).toBe(
      'id, fighter_weapons!inner(weapon_id)',
    );
    expect(filtersFor(withWeapon.supabase.from, 'global_persons', 'eq')).toContainEqual([
      'fighter_weapons.weapon_id',
      WEAPON,
    ]);
  });
});

describe('SparFindService.browse, blocks', () => {
  it('leaves out who I blocked, in the query, and keeps who blocked me', async () => {
    const { find, supabase } = service();
    const listed = names(await find.browse(MARC, undefined, undefined, 0));
    expect(listed).not.toContain('Paul Charlie');
    expect(listed).toContain('Hugo Bravo');
    expect(filtersFor(supabase.from, 'global_persons', 'not')).toContainEqual([
      'id',
      'in',
      `(${BLOCKED})`,
    ]);
  });

  it('sends no block filter when I blocked nobody', async () => {
    const { find, supabase } = service({ blocks: [block(BLOCKER, MARC)] });
    expect(names(await find.browse(MARC, undefined, undefined, 0))).toContain('Paul Charlie');
    expect(filtersFor(supabase.from, 'global_persons', 'not')).toEqual([
      ['claimed_by_user_id', 'is', null],
    ]);
  });

  it('sends 200 of 201 blocks, and still drops the 201st from the page', async () => {
    const others = Array.from({ length: IN_LIST_MAX }, (_, n) => filler(500 + n));
    const blocks = [...others, BLOCKED].map((id) => block(MARC, id));
    const { find, supabase } = service({ blocks });
    expect(names(await find.browse(MARC, undefined, undefined, 0))).toEqual([
      'Julie Alpha',
      'Hugo Bravo',
    ]);
    const notIn = filtersFor(supabase.from, 'global_persons', 'not').filter((f) => f[1] === 'in');
    expect(notIn).toEqual([['id', 'in', `(${others.join(',')})`]]);
  });
});
