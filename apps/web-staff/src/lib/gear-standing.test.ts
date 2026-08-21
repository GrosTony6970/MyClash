import { describe, expect, it } from 'vitest';
import {
  countMatchingQuery,
  countsByStanding,
  GEAR_TABS,
  standingFor,
  standingSemantic,
  visibleGear,
  type GearStanding,
} from './gear-standing';
import type { GearEntry, GearResult, WeaponStatus } from './useGear';

function weapon(weaponId: string, result: GearResult | null): WeaponStatus {
  return { weaponId, weaponName: weaponId, result, reason: null, checkedAt: null };
}

function entry(personId: string, weapons: WeaponStatus[], familyName = 'Dubois'): GearEntry {
  return {
    person: {
      personId,
      givenName: 'Marie',
      familyName,
      clubName: null,
      clubLogoUrl: null,
      photoUrl: null,
      arrived: false,
      arrivedAt: null,
      via: null,
      next: null,
    },
    weapons,
  };
}

describe('standingFor', () => {
  it('takes the worst result when a fighter weapons disagree', () => {
    // A fighter with a passed longsword and a failed rapier must not be
    // reachable through the Pass tab — that is the whole point of the ranking.
    expect(standingFor(entry('p', [weapon('longsword', 'pass'), weapon('rapier', 'fail')]))).toBe(
      'fail',
    );
  });

  it('ranks conditional above pass', () => {
    expect(
      standingFor(entry('p', [weapon('longsword', 'pass'), weapon('rapier', 'conditional')])),
    ).toBe('conditional');
  });

  it('ranks fail above conditional', () => {
    expect(
      standingFor(entry('p', [weapon('longsword', 'conditional'), weapon('rapier', 'fail')])),
    ).toBe('fail');
  });

  it('calls a half-checked fighter To check, not Pass', () => {
    // The Pass tab means every entered weapon passed — a longsword pass says
    // nothing about the rapier they fight with after lunch.
    expect(standingFor(entry('p', [weapon('longsword', 'pass'), weapon('rapier', null)]))).toBe(
      'unchecked',
    );
  });

  it('calls a fully-passed fighter Pass', () => {
    expect(standingFor(entry('p', [weapon('longsword', 'pass'), weapon('rapier', 'pass')]))).toBe(
      'pass',
    );
  });

  it('puts a fighter with no resolvable weapon in To check', () => {
    // `tournaments.weapon` is free text, so a name that never resolved to a
    // catalog entry leaves a person with no lines at all — and they are exactly
    // who the gear table needs to notice.
    expect(standingFor(entry('p', []))).toBe('unchecked');
  });
});

describe('standingSemantic', () => {
  it('gives conditional and unchecked different colours', () => {
    // StatusBadge takes one of seven canonical semantics. Mapping both of these
    // onto 'pending' would paint two states the same on the screen built to
    // tell them apart.
    expect(standingSemantic('conditional')).not.toBe(standingSemantic('unchecked'));
  });

  it.each<GearStanding>(['fail', 'conditional', 'unchecked', 'pass'])(
    'has a semantic for %s',
    (standing) => {
      expect(standingSemantic(standing)).toBeTruthy();
    },
  );
});

/**
 * The claim this whole screen rests on.
 *
 * A tab reads "To check (12)" and a volunteer taps it expecting 12 rows.
 * Counting and filtering are two functions, so either could drift while both
 * stay green on their own tests — this is what makes them one answer.
 */
describe('the count on a tab equals the rows behind it', () => {
  const entries = [
    entry('a', [weapon('longsword', 'pass')], 'Alvarez'),
    entry('b', [weapon('longsword', 'fail')], 'Bonnet'),
    entry('c', [weapon('longsword', 'conditional')], 'Chen'),
    entry('d', [weapon('longsword', null)], 'Dubois'),
    entry('e', [], 'Evans'),
    entry('f', [weapon('longsword', 'pass'), weapon('rapier', 'fail')], 'Fabre'),
  ];

  it.each(GEAR_TABS)('holds for the %s tab', (tab) => {
    expect(visibleGear(entries, tab, '')).toHaveLength(countsByStanding(entries)[tab]);
  });

  it('accounts for every fighter exactly once across the four states', () => {
    const counts = countsByStanding(entries);

    expect(counts.unchecked + counts.pass + counts.conditional + counts.fail).toBe(counts.all);
  });
});

describe('visibleGear', () => {
  const entries = [
    entry('martin', [weapon('longsword', 'pass')], 'Martin'),
    entry('martel', [weapon('longsword', 'fail')], 'Martel'),
    entry('zulu', [weapon('longsword', 'fail')], 'Zulu'),
  ];

  it('applies the tab and the search together', () => {
    expect(visibleGear(entries, 'fail', 'mart').map((e) => e.person.personId)).toEqual(['martel']);
  });

  it('ignores a search shorter than two characters', () => {
    expect(visibleGear(entries, 'all', 'm')).toHaveLength(3);
  });
});

describe('countMatchingQuery', () => {
  it('counts across the whole roster, whatever tab is open', () => {
    const entries = [
      entry('martin', [weapon('longsword', 'pass')], 'Martin'),
      entry('martel', [weapon('longsword', 'fail')], 'Martel'),
      entry('zulu', [weapon('longsword', 'fail')], 'Zulu'),
    ];

    expect(countMatchingQuery(entries, 'mart')).toBe(2);
  });
});
