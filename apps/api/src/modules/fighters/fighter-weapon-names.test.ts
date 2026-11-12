import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX, READ_PAGE } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { DIRECTORY_WEAPONS_SHOWN, readFighterWeaponNames } from './fighter-weapon-names';

const A = 'gp-a';
const B = 'gp-b';
const STRANGER = 'gp-stranger';

const link = (gp: string, name: string, favorite: boolean, sort: number) => ({
  global_person_id: gp,
  favorite,
  sort_order: sort,
  weapon_catalog: { name },
});

const weaponRows = [
  link(A, 'Rapier', false, 1),
  link(A, 'Longsword', true, 5),
  link(A, 'Sabre', false, 0),
  link(A, 'Dagger', false, 2),
  link(B, 'Messer', false, 0),
  link(STRANGER, 'Spear', true, 0),
];

describe('readFighterWeaponNames', () => {
  it('reads the weapon links of the asked fighters only, favourites first then sort order', async () => {
    const db = mockSupabase({ fighter_weapons: { rows: weaponRows } });
    const names = await readFighterWeaponNames(db as never, [A, B]);

    // Two reads: the page with the rows, then the empty page that ends the loop.
    const select = 'global_person_id, favorite, sort_order, weapon_catalog(name)';
    expect(selectsFor(db.from, 'fighter_weapons')).toEqual([select, select]);
    const asked = ['global_person_id', [A, B]];
    expect(filtersFor(db.from, 'fighter_weapons', 'in')).toEqual([asked, asked]);
    const order = [
      ['global_person_id', { ascending: true }],
      ['favorite', { ascending: false }],
      ['sort_order', { ascending: true }],
      ['id', { ascending: true }],
    ];
    expect(filtersFor(db.from, 'fighter_weapons', 'order')).toEqual([...order, ...order]);
    expect(names.get(A)).toEqual(['Longsword', 'Sabre', 'Rapier', 'Dagger']);
    expect(names.get(B)).toEqual(['Messer']);
    expect(names.has(STRANGER)).toBe(false);
  });

  it('keeps all weapons with no cap, and the first three with the directory cap', async () => {
    const db = mockSupabase({ fighter_weapons: { rows: weaponRows } });
    expect((await readFighterWeaponNames(db as never, [A])).get(A)).toHaveLength(4);
    const capped = await readFighterWeaponNames(db as never, [A], DIRECTORY_WEAPONS_SHOWN);
    expect(capped.get(A)).toEqual(['Longsword', 'Sabre', 'Rapier']);
  });

  it('reads one piece in pages until an empty page, so a 1000-row cut loses no weapon', async () => {
    const rows = Array.from({ length: READ_PAGE + 3 }, (_, i) => link(A, `Weapon ${i}`, false, i));
    const db = mockSupabase({ fighter_weapons: { rows: [...rows, link(B, 'Messer', false, 0)] } });
    const names = await readFighterWeaponNames(db as never, [A, B]);

    expect(filtersFor(db.from, 'fighter_weapons', 'range')).toEqual([
      [0, READ_PAGE - 1],
      [READ_PAGE, 2 * READ_PAGE - 1],
      // The third read starts after the 1004 rows held, and answers empty.
      [READ_PAGE + 4, 2 * READ_PAGE + 3],
    ]);
    expect(names.get(A)).toHaveLength(READ_PAGE + 3);
    expect(names.get(A)?.[0]).toBe('Weapon 0');
    expect(names.get(A)?.at(-1)).toBe(`Weapon ${READ_PAGE + 2}`);
    expect(names.get(B)).toEqual(['Messer']);
  });

  it('reads in pieces no longer than a .in() list may be, and answers for all fighters', async () => {
    const many = Array.from({ length: IN_LIST_MAX + 5 }, (_, index) => `gp-${index}`);
    const first = many[0]!;
    const last = many[many.length - 1]!;
    const db = mockSupabase({
      fighter_weapons: { rows: [link(first, 'Rapier', false, 0), link(last, 'Sabre', false, 0)] },
    });
    const names = await readFighterWeaponNames(db as never, many);

    const lists = filtersFor(db.from, 'fighter_weapons', 'in').map(([, list]) => list as string[]);
    expect(lists.map((list) => list.length)).toEqual([IN_LIST_MAX, IN_LIST_MAX, 5, 5]);
    expect(names.get(first)).toEqual(['Rapier']);
    expect(names.get(last)).toEqual(['Sabre']);
  });

  it('reads nothing for no fighters', async () => {
    const db = mockSupabase({ fighter_weapons: { rows: weaponRows } });
    expect((await readFighterWeaponNames(db as never, [])).size).toBe(0);
    expect(selectsFor(db.from, 'fighter_weapons')).toEqual([]);
  });

  it('throws on a failed read instead of showing no weapons', async () => {
    const db = mockSupabase({
      fighter_weapons: { data: null, error: { message: 'boom' } },
    });
    await expect(readFighterWeaponNames(db as never, [A])).rejects.toThrow(
      'Fighter weapons read failed: boom',
    );
  });
});
