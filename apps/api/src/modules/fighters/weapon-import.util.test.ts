import { describe, expect, it } from 'vitest';
import { parseWeaponsCell, replaceFighterWeaponsFromCell } from './weapon-import.util';

describe('parseWeaponsCell', () => {
  it('returns [] for blank input', () => {
    expect(parseWeaponsCell('')).toEqual([]);
    expect(parseWeaponsCell(null)).toEqual([]);
    expect(parseWeaponsCell(undefined)).toEqual([]);
  });

  it('parses names, levels, and marks the first as favorite', () => {
    expect(parseWeaponsCell('Longsword:intermediate|Rapier|Sabre:beginner')).toEqual([
      { weaponName: 'Longsword', level: 'intermediate', favorite: true },
      { weaponName: 'Rapier', level: null, favorite: false },
      { weaponName: 'Sabre', level: 'beginner', favorite: false },
    ]);
  });

  it('ignores unknown levels (keeps the weapon, drops the level)', () => {
    expect(parseWeaponsCell('Longsword:expert')).toEqual([
      { weaponName: 'Longsword', level: null, favorite: true },
    ]);
  });

  it('trims whitespace and skips empty segments', () => {
    expect(parseWeaponsCell(' Longsword : advanced | | Messer ')).toEqual([
      { weaponName: 'Longsword', level: 'advanced', favorite: true },
      { weaponName: 'Messer', level: null, favorite: false },
    ]);
  });
});

describe('replaceFighterWeaponsFromCell', () => {
  function makeClient(existingWeaponIds: Record<string, string> = {}) {
    const inserts: Record<string, unknown[]> = {};
    const deletes: string[] = [];
    const service = {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, value: unknown) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: existingWeaponIds[value as string]
                  ? { id: existingWeaponIds[value as string] }
                  : null,
                error: null,
              }),
          }),
        }),
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
          const items = Array.isArray(payload) ? payload : [payload];
          inserts[table] = [...(inserts[table] ?? []), ...items];
          const chain = {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: `new-${table}-${items.length}` }, error: null }),
            }),
            then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
        delete: () => ({
          eq: (_col: string, value: unknown) => {
            deletes.push(value as string);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return { service, inserts, deletes };
  }

  it('is a no-op for an empty cell (never wipes existing weapons)', async () => {
    const { service, inserts, deletes } = makeClient();
    await replaceFighterWeaponsFromCell(service as never, 'gp-1', '');
    expect(deletes).toEqual([]);
    expect(inserts['fighter_weapons']).toBeUndefined();
  });

  it('resolves catalog ids (existing by slug) and inserts fighter_weapons', async () => {
    const { service, inserts, deletes } = makeClient({ longsword: 'w-ls' });
    await replaceFighterWeaponsFromCell(service as never, 'gp-1', 'Longsword:advanced');
    // deletes existing rows first, then inserts the new set
    expect(deletes).toEqual(['gp-1']);
    const rows = inserts['fighter_weapons'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      global_person_id: 'gp-1',
      weapon_id: 'w-ls',
      favorite: true,
      level: 'advanced',
      sort_order: 0,
    });
  });

  it('creates missing weapon_catalog rows for unknown weapons', async () => {
    const { service, inserts } = makeClient();
    await replaceFighterWeaponsFromCell(service as never, 'gp-1', 'Obscure Weapon');
    // a weapon_catalog insert happened for the unknown weapon
    expect(inserts['weapon_catalog']).toHaveLength(1);
    expect((inserts['weapon_catalog'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'Obscure Weapon',
      slug: 'obscure-weapon',
      // Import-created rows are inactive until a super-admin promotes them, so
      // unvetted names never leak into the strict tournament/workshop picker.
      active: false,
    });
    expect(inserts['fighter_weapons']).toHaveLength(1);
  });
});
