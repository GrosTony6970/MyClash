import { describe, expect, it } from 'vitest';
import {
  countMatchingQuery,
  countsByTab,
  DESK_TABS,
  orderBySoonest,
  visibleRoster,
} from './desk-view';
import type { RosterEntry } from './useDesk';

function person(over: Partial<RosterEntry> & { personId: string }): RosterEntry {
  return {
    givenName: 'Marie',
    familyName: 'Dubois',
    clubName: null,
    clubLogoUrl: null,
    photoUrl: null,
    arrived: false,
    arrivedAt: null,
    via: null,
    next: null,
    ...over,
  };
}

function due(personId: string, scheduledAt: string | null, familyName = 'Zulu'): RosterEntry {
  return person({
    personId,
    familyName,
    next:
      scheduledAt === null
        ? null
        : { scheduledAt, liceName: null, poolName: null, tournamentName: null },
  });
}

describe('countsByTab', () => {
  it('splits the roster into arrived and not, with All as the whole', () => {
    const counts = countsByTab([
      person({ personId: 'a', arrived: true }),
      person({ personId: 'b' }),
      person({ personId: 'c' }),
    ]);

    expect(counts).toEqual({ all: 3, arrived: 1, notArrived: 2 });
  });
});

/**
 * The claim this whole screen rests on.
 *
 * A tab reads "Not arrived (63)" and a volunteer taps it expecting 63 rows.
 * Counting and filtering are two functions, so either could drift while both
 * stay green on their own tests — this is what makes them one answer.
 */
describe('the count on a tab equals the rows behind it', () => {
  const roster = [
    person({ personId: 'a', arrived: true, familyName: 'Alvarez' }),
    person({ personId: 'b', familyName: 'Bonnet' }),
    person({ personId: 'c', arrived: true, familyName: 'Chen' }),
    person({ personId: 'd', familyName: 'Dubois' }),
    person({ personId: 'e', familyName: 'Evans' }),
  ];

  it.each(DESK_TABS)('holds for the %s tab', (tab) => {
    expect(visibleRoster(roster, tab, '')).toHaveLength(countsByTab(roster)[tab]);
  });
});

describe('visibleRoster', () => {
  const roster = [
    person({ personId: 'arrived', arrived: true, familyName: 'Martin' }),
    person({ personId: 'absent', familyName: 'Martel' }),
    person({ personId: 'other', familyName: 'Zulu' }),
  ];

  it('applies the tab and the search together', () => {
    // Both apply on purpose. The empty state is what tells a volunteer their
    // person is one tab away, rather than leaving them at "no results".
    const shown = visibleRoster(roster, 'notArrived', 'mart');

    expect(shown.map((p) => p.personId)).toEqual(['absent']);
  });

  it('ignores a search shorter than two characters', () => {
    expect(visibleRoster(roster, 'all', 'm')).toHaveLength(3);
  });

  it('matches on the given name as well as the family name', () => {
    expect(visibleRoster(roster, 'all', 'marie')).toHaveLength(3);
  });

  it('orders the Not-arrived tab by who fights soonest', () => {
    const shown = visibleRoster(
      [
        due('late', '2026-08-08T14:00:00.000Z'),
        due('soon', '2026-08-08T10:00:00.000Z'),
        due('mid', '2026-08-08T11:00:00.000Z'),
      ],
      'notArrived',
      '',
    );

    expect(shown.map((p) => p.personId)).toEqual(['soon', 'mid', 'late']);
  });

  it('orders every other tab by name', () => {
    const shown = visibleRoster(
      [
        due('z', '2026-08-08T10:00:00.000Z', 'Zulu'),
        due('a', '2026-08-08T14:00:00.000Z', 'Alvarez'),
      ],
      'all',
      '',
    );

    expect(shown.map((p) => p.personId)).toEqual(['a', 'z']);
  });
});

describe('orderBySoonest', () => {
  it('sorts fighters with no scheduled bout LAST, without dropping them', () => {
    // They are still missing — just not yet costing anyone time. Filtering them
    // out would quietly shrink a count the desk is trusted to have complete.
    const ordered = orderBySoonest([
      due('unscheduled', null),
      due('scheduled', '2026-08-08T14:00:00.000Z'),
    ]);

    expect(ordered.map((p) => p.personId)).toEqual(['scheduled', 'unscheduled']);
    expect(ordered).toHaveLength(2);
  });

  it('breaks ties by name so the list does not reshuffle on every refetch', () => {
    const sameTime = '2026-08-08T10:00:00.000Z';
    const ordered = orderBySoonest([due('b', sameTime, 'Bonnet'), due('a', sameTime, 'Alvarez')]);

    expect(ordered.map((p) => p.personId)).toEqual(['a', 'b']);
  });

  it('orders the unscheduled tail by name too, for the same reason', () => {
    const ordered = orderBySoonest([due('vik', null, 'Vik'), due('alvarez', null, 'Alvarez')]);

    expect(ordered.map((p) => p.personId)).toEqual(['alvarez', 'vik']);
  });

  it('does not mutate its input', () => {
    const input = [
      due('late', '2026-08-08T14:00:00.000Z'),
      due('soon', '2026-08-08T10:00:00.000Z'),
    ];

    orderBySoonest(input);

    expect(input.map((p) => p.personId)).toEqual(['late', 'soon']);
  });
});

describe('countMatchingQuery', () => {
  it('counts across the whole roster, whatever tab is open', () => {
    // This is the number the empty state offers as a way out of a tab, so it
    // must ignore the tab entirely.
    const roster = [
      person({ personId: 'a', arrived: true, familyName: 'Martin' }),
      person({ personId: 'b', familyName: 'Martel' }),
      person({ personId: 'c', familyName: 'Zulu' }),
    ];

    expect(countMatchingQuery(roster, 'mart')).toBe(2);
  });
});
