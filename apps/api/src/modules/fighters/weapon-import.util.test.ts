import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { MAX_FIGHTER_WEAPONS } from './fighter-weapon-names';
import {
  matchCatalogWeapon,
  parseWeaponsCell,
  replaceFighterWeaponsFromCell,
  unknownWeaponNames,
} from './weapon-import.util';

describe('parseWeaponsCell', () => {
  it('keeps the first 20 entries of a longer cell, the first still the favourite', () => {
    const cell = Array.from({ length: MAX_FIGHTER_WEAPONS + 1 }, (_, i) => `Weapon ${i}`).join('|');
    const parsed = parseWeaponsCell(cell);
    expect(parsed).toHaveLength(MAX_FIGHTER_WEAPONS);
    expect(parsed[0]).toMatchObject({ weaponName: 'Weapon 0', favorite: true });
    expect(parsed.at(-1)?.weaponName).toBe('Weapon 19');
  });

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

// A super admin renamed "Sword and Buckler" to "Sword & Buckler"; the slug stayed.
const CATALOG = [
  { id: 'w-ls', name: 'Longsword', slug: 'longsword', active: true },
  { id: 'w-sb', name: 'Sword & Buckler', slug: 'sword-and-buckler', active: true },
  { id: 'w-ra', name: 'Rapier', slug: 'rapier', active: false },
];

describe('matching a CSV name to the catalog (ruling 695)', () => {
  it('matches the name whatever its case and spacing', () => {
    expect(matchCatalogWeapon(CATALOG, '  LONGSWORD ')).toBe('w-ls');
    expect(matchCatalogWeapon(CATALOG, 'sword & buckler')).toBe('w-sb');
  });

  it("matches a renamed weapon's old spelling by its slug", () => {
    expect(matchCatalogWeapon(CATALOG, 'Sword and Buckler')).toBe('w-sb');
  });

  it("prefers a weapon's name to another weapon's old slug", () => {
    // "Sabre" was renamed "Military Sabre" (slug kept); a later weapon was named "Sabre".
    const renamed = [
      { id: 'w-old', name: 'Military Sabre', slug: 'sabre' },
      { id: 'w-new', name: 'Sabre', slug: 'hungarian-sabre' },
    ];
    expect(matchCatalogWeapon(renamed, 'Sabre')).toBe('w-new');
  });

  it('matches a hidden weapon: the list is the whole catalog (ruling 702)', () => {
    expect(matchCatalogWeapon(CATALOG, 'Rapier')).toBe('w-ra');
  });

  it('matches nothing for an unknown name or a name with no letter', () => {
    expect(matchCatalogWeapon(CATALOG, 'Longsowrd')).toBeNull();
    expect(matchCatalogWeapon([...CATALOG, { id: 'w-x', name: '?', slug: '' }], '!!!')).toBeNull();
  });

  it('names the unknown entries of a cell, in cell order (ruling 703)', () => {
    expect(unknownWeaponNames(CATALOG, 'Longsword|Longsowrd:beginner|Sabre')).toEqual([
      'Longsowrd',
      'Sabre',
    ]);
    expect(unknownWeaponNames(CATALOG, 'Longsword|Rapier')).toEqual([]);
    expect(unknownWeaponNames(CATALOG, '')).toEqual([]);
  });
});

describe('replaceFighterWeaponsFromCell', () => {
  const importing = () =>
    mockSupabase({ weapon_catalog: { rows: CATALOG }, fighter_weapons: { rows: [] } });

  it('is a no-op for an empty cell (never wipes existing weapons)', async () => {
    const db = importing();
    await replaceFighterWeaponsFromCell(db.service as never, 'gp-1', '');
    expect(db.writes).toEqual([]);
    expect(selectsFor(db.from, 'weapon_catalog')).toEqual([]);
  });

  it('links catalog weapons and skips an unknown one (ruling 703)', async () => {
    const db = importing();
    await replaceFighterWeaponsFromCell(
      db.service as never,
      'gp-1',
      'Longsowrd|Longsword:advanced|Sword and Buckler',
    );
    expect(selectsFor(db.from, 'weapon_catalog')).toEqual(['id, name, slug']);
    const writes = writesTo(db, 'fighter_weapons');
    expect(writes.map((w) => w.op)).toEqual(['delete', 'insert']);
    expect(writes[1]?.row).toEqual([
      {
        global_person_id: 'gp-1',
        weapon_id: 'w-ls',
        favorite: false,
        level: 'advanced',
        sort_order: 1,
      },
      { global_person_id: 'gp-1', weapon_id: 'w-sb', favorite: false, level: null, sort_order: 2 },
    ]);
  });

  it('links a weapon once when the cell spells it twice', async () => {
    const db = importing();
    await replaceFighterWeaponsFromCell(
      db.service as never,
      'gp-1',
      'Sword & Buckler|Sword and Buckler',
    );
    expect(writesTo(db, 'fighter_weapons')[1]?.row).toEqual([
      expect.objectContaining({ weapon_id: 'w-sb', favorite: true }),
    ]);
  });

  it('keeps the existing weapons when no name in the cell is on the list', async () => {
    const db = importing();
    await replaceFighterWeaponsFromCell(db.service as never, 'gp-1', 'Longsowrd|Obscure Weapon');
    expect(writesTo(db, 'fighter_weapons')).toEqual([]);
  });

  it('never writes the catalog (ruling 695)', async () => {
    const db = importing();
    await replaceFighterWeaponsFromCell(db.service as never, 'gp-1', 'Obscure Weapon|Longsword');
    expect(writesTo(db, 'weapon_catalog')).toEqual([]);
  });
});
