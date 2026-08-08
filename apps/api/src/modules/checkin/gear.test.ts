import { describe, expect, it } from 'vitest';
import { buildGearEntry, latestCheckPerWeapon, type GearCheckRow } from './gear';
import { mapRosterRow, type RosterPersonRow } from './roster';

const PERSON: RosterPersonRow = {
  id: 'p1',
  given_name: 'Julie',
  family_name: 'Bonnet',
  club_id: null,
  global_person_id: null,
  clubs: null,
  global_persons: null,
};

function check(over: Partial<GearCheckRow> = {}): GearCheckRow {
  return {
    person_id: 'p1',
    weapon_id: 'w-longsword',
    result: 'pass',
    reason: null,
    checked_at: '2026-08-08T09:00:00.000Z',
    ...over,
  };
}

describe('latestCheckPerWeapon', () => {
  it('takes the newest row per (person, weapon), which is the re-check', () => {
    // 0175 is append-only precisely so "failed at 09:20, passed at 09:50" is
    // readable. The current answer must be the second one.
    const latest = latestCheckPerWeapon([
      check({ result: 'fail', checked_at: '2026-08-08T09:20:00.000Z' }),
      check({ result: 'pass', checked_at: '2026-08-08T09:50:00.000Z' }),
    ]);

    expect(latest.get('p1:w-longsword')?.result).toBe('pass');
  });

  it('does not depend on the query ordering to pick the winner', () => {
    // The query orders checked_at DESC, but comparing timestamps rather than
    // trusting arrival order means a caller who forgets the ORDER BY gets the
    // right answer instead of a silently stale one.
    const latest = latestCheckPerWeapon([
      check({ result: 'pass', checked_at: '2026-08-08T09:50:00.000Z' }),
      check({ result: 'fail', checked_at: '2026-08-08T09:20:00.000Z' }),
    ]);

    expect(latest.get('p1:w-longsword')?.result).toBe('pass');
  });

  it('keeps weapons independent for the same person', () => {
    const latest = latestCheckPerWeapon([
      check({ weapon_id: 'w-longsword', result: 'pass' }),
      check({ weapon_id: 'w-rapier', result: 'fail' }),
    ]);

    expect(latest.get('p1:w-longsword')?.result).toBe('pass');
    expect(latest.get('p1:w-rapier')?.result).toBe('fail');
  });
});

describe('buildGearEntry', () => {
  const person = mapRosterRow(PERSON, null);

  it('renders one line per entered weapon, unchecked until there is a row', () => {
    const entry = buildGearEntry(
      person,
      [
        { id: 'w-longsword', name: 'Longsword' },
        { id: 'w-rapier', name: 'Rapier' },
      ],
      latestCheckPerWeapon([check({ weapon_id: 'w-longsword', result: 'pass' })]),
    );

    expect(entry.weapons.map((w) => [w.weaponName, w.result])).toEqual([
      ['Longsword', 'pass'],
      ['Rapier', null],
    ]);
  });

  it('carries the reason so the piste can read WHAT to watch for', () => {
    const entry = buildGearEntry(
      person,
      [{ id: 'w-longsword', name: 'Longsword' }],
      latestCheckPerWeapon([
        check({ result: 'conditional', reason: 'gorget too loose, retighten before first bout' }),
      ]),
    );

    expect(entry.weapons[0]?.reason).toMatch(/gorget/);
  });

  it('keeps a fighter with NO resolvable weapon on the screen', () => {
    // tournaments.weapon is free text, so a typo that fails to resolve to a
    // catalog entry is real and silent. A fighter who vanishes from the gear
    // screen entirely is worse than one the volunteer can see and escalate.
    const entry = buildGearEntry(person, [], new Map());

    expect(entry.person.personId).toBe('p1');
    expect(entry.weapons).toEqual([]);
  });

  it('treats an unrecognised stored result as unchecked, never as a pass', () => {
    // The direction matters: a value this build does not know about must read
    // as "not checked", not as "cleared to fight".
    const entry = buildGearEntry(
      person,
      [{ id: 'w-longsword', name: 'Longsword' }],
      latestCheckPerWeapon([check({ result: 'probably_fine' })]),
    );

    expect(entry.weapons[0]?.result).toBeNull();
  });
});
