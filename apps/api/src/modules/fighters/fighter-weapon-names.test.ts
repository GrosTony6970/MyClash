import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import {
  DIRECTORY_WEAPONS_SHOWN,
  readFighterWeaponNames,
  WEAPON_IDS_PER_READ,
} from './fighter-weapon-names';

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

    expect(selectsFor(db.from, 'fighter_weapons')).toEqual([
      'global_person_id, favorite, sort_order, weapon_catalog(name)',
    ]);
    expect(filtersFor(db.from, 'fighter_weapons', 'in')).toEqual([['global_person_id', [A, B]]]);
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

  it('reads 50 fighters at a time, so 1000 weapon rows are never cut, and answers for all', async () => {
    const many = Array.from({ length: 2 * WEAPON_IDS_PER_READ + 5 }, (_, index) => `gp-${index}`);
    const first = many[0]!;
    const last = many[many.length - 1]!;
    const db = mockSupabase({
      fighter_weapons: { rows: [link(first, 'Rapier', false, 0), link(last, 'Sabre', false, 0)] },
    });
    const names = await readFighterWeaponNames(db as never, many);

    const lists = filtersFor(db.from, 'fighter_weapons', 'in').map(([, list]) => list as string[]);
    expect(lists.map((list) => list.length)).toEqual([50, 50, 5]);
    expect(WEAPON_IDS_PER_READ).toBeLessThanOrEqual(IN_LIST_MAX);
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
