import { describe, expect, it } from 'vitest';
import { fuzzyMatch, sortRows } from '@myclash/ui';
import {
  EMPTY_WORKSHOP_FILTER,
  NO_VENUE,
  deriveWorkshopFilterOptions,
  effectiveVenue,
  isWorkshopFilterActive,
  workshopMatchesFilter,
  workshopSearchHaystack,
  workshopSortValue,
} from './filter-workshops';

interface NamedRef {
  id: string;
  name: string;
}

interface Session {
  startsAt: string | null;
  venueId: string | null;
  venue: NamedRef | null;
}

/** The subset of the page's `Workshop` the filter/sort helpers read. */
interface Row {
  title: string;
  category: string | null;
  level: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  status: string;
  instructors: Array<{ displayName: string }>;
  venueId: string | null;
  venue: NamedRef | null;
  sessions: Session[];
}

const workshop = (over: Partial<Row> = {}): Row => ({
  title: 'Demo Workshop 1',
  category: 'Technique',
  level: 'all',
  capacity: 12,
  durationMinutes: 120,
  status: 'published',
  instructors: [{ displayName: 'Mahmoud Fakhfakh' }, { displayName: 'David Perchais' }],
  venueId: null,
  venue: null,
  sessions: [],
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  startsAt: null,
  venueId: null,
  venue: null,
  ...over,
});

/** The page applies the query exactly like this, so test the pair together. */
const matchesQuery = (query: string, row: Row) => fuzzyMatch(query, workshopSearchHaystack(row));

describe('workshopSearchHaystack + fuzzyMatch', () => {
  it('matches on the title', () => {
    expect(matchesQuery('demo', workshop())).toBe(true);
    expect(matchesQuery('sparring', workshop())).toBe(false);
  });

  it('matches on an instructor name alone', () => {
    expect(matchesQuery('perchais', workshop())).toBe(true);
  });

  it('is diacritic- and case-insensitive', () => {
    const row = workshop({ instructors: [{ displayName: 'Léo Ferrand' }] });
    expect(matchesQuery('leo', row)).toBe(true);
    expect(matchesQuery('FERRAND', row)).toBe(true);
  });

  it('AND-matches every token, in any order, across title and instructors', () => {
    const row = workshop({
      title: 'Demo Workshop 3',
      instructors: [{ displayName: 'Léo Ferrand' }, { displayName: 'Anthony Garnier' }],
    });
    expect(matchesQuery('garnier ferrand', row)).toBe(true);
    expect(matchesQuery('workshop garnier', row)).toBe(true);
    expect(matchesQuery('garnier felenczak', row)).toBe(false);
  });

  it('keeps every row for an empty or whitespace query', () => {
    expect(matchesQuery('', workshop())).toBe(true);
    expect(matchesQuery('   ', workshop())).toBe(true);
  });

  it('does not search the category or level columns', () => {
    expect(matchesQuery('technique', workshop())).toBe(false);
  });
});

describe('effectiveVenue', () => {
  const hall = { id: 'v-1', name: 'Gymnase des Cerisiers' };
  const annex = { id: 'v-2', name: 'Annexe' };

  it('prefers the scheduled session venue over the workshop default', () => {
    const row = workshop({ venue: hall, venueId: hall.id, sessions: [session({ venue: annex })] });
    expect(effectiveVenue(row)).toEqual(annex);
  });

  it('falls back to the workshop default when the session has none', () => {
    const row = workshop({ venue: hall, venueId: hall.id, sessions: [session()] });
    expect(effectiveVenue(row)).toEqual(hall);
  });

  it('is null when nothing names a venue', () => {
    expect(effectiveVenue(workshop())).toBeNull();
  });
});

describe('workshopMatchesFilter', () => {
  it('keeps everything when no dropdown is set', () => {
    expect(workshopMatchesFilter(workshop(), EMPTY_WORKSHOP_FILTER)).toBe(true);
  });

  it('matches category and level exactly, treating null as unset', () => {
    const filter = { ...EMPTY_WORKSHOP_FILTER, category: 'Technique' };
    expect(workshopMatchesFilter(workshop(), filter)).toBe(true);
    expect(workshopMatchesFilter(workshop({ category: 'Sparring' }), filter)).toBe(false);
    expect(workshopMatchesFilter(workshop({ category: null }), filter)).toBe(false);

    const byLevel = { ...EMPTY_WORKSHOP_FILTER, level: 'beginner' };
    expect(workshopMatchesFilter(workshop({ level: 'beginner' }), byLevel)).toBe(true);
    expect(workshopMatchesFilter(workshop({ level: 'advanced' }), byLevel)).toBe(false);
  });

  it('filters by the effective venue id', () => {
    const venue = { id: 'v-1', name: 'Gymnase des Cerisiers' };
    const filter = { ...EMPTY_WORKSHOP_FILTER, venue: 'v-1' };
    expect(workshopMatchesFilter(workshop({ sessions: [session({ venue })] }), filter)).toBe(true);
    expect(workshopMatchesFilter(workshop({ venue, venueId: 'v-1' }), filter)).toBe(true);
    expect(workshopMatchesFilter(workshop(), filter)).toBe(false);
  });

  it('NO_VENUE keeps only workshops with no venue anywhere', () => {
    const filter = { ...EMPTY_WORKSHOP_FILTER, venue: NO_VENUE };
    expect(workshopMatchesFilter(workshop(), filter)).toBe(true);
    expect(workshopMatchesFilter(workshop({ venueId: 'v-1' }), filter)).toBe(false);
  });

  it('ANDs the dropdowns together', () => {
    const filter = { category: 'Sparring', level: 'all', venue: '' };
    expect(workshopMatchesFilter(workshop({ category: 'Sparring', level: 'all' }), filter)).toBe(
      true,
    );
    expect(
      workshopMatchesFilter(workshop({ category: 'Sparring', level: 'beginner' }), filter),
    ).toBe(false);
  });
});

describe('deriveWorkshopFilterOptions', () => {
  it('dedupes, drops blanks, and sorts alphabetically', () => {
    const options = deriveWorkshopFilterOptions([
      workshop({ category: 'Technique', level: 'all' }),
      workshop({ category: 'Sparring', level: 'beginner' }),
      workshop({ category: 'Technique', level: 'beginner' }),
      workshop({ category: null, level: '  ' }),
    ]);
    expect(options.categories).toEqual(['Sparring', 'Technique']);
    expect(options.levels).toEqual(['all', 'beginner']);
  });

  it('collects effective venues by id and reports unvenued rows', () => {
    const hall = { id: 'v-1', name: 'Gymnase des Cerisiers' };
    const annex = { id: 'v-2', name: 'Annexe' };
    const options = deriveWorkshopFilterOptions([
      workshop({ sessions: [session({ venue: hall })] }),
      workshop({ venue: annex, venueId: annex.id }),
      workshop({ venue: hall, venueId: hall.id }),
      workshop(),
    ]);
    expect(options.venues).toEqual([annex, hall]);
    expect(options.hasUnvenued).toBe(true);
  });

  it('reports no unvenued rows when every workshop has one', () => {
    const hall = { id: 'v-1', name: 'Gymnase des Cerisiers' };
    const options = deriveWorkshopFilterOptions([workshop({ venue: hall, venueId: hall.id })]);
    expect(options.hasUnvenued).toBe(false);
  });
});

describe('isWorkshopFilterActive', () => {
  it('is false only when nothing is set', () => {
    expect(isWorkshopFilterActive(EMPTY_WORKSHOP_FILTER, '')).toBe(false);
    expect(isWorkshopFilterActive(EMPTY_WORKSHOP_FILTER, '  ')).toBe(false);
    expect(isWorkshopFilterActive(EMPTY_WORKSHOP_FILTER, 'leo')).toBe(true);
    expect(isWorkshopFilterActive({ ...EMPTY_WORKSHOP_FILTER, venue: NO_VENUE }, '')).toBe(true);
  });
});

describe('workshopSortValue', () => {
  it('reads each column, and null for an unknown key', () => {
    const hall = { id: 'v-1', name: 'Gymnase des Cerisiers' };
    const row = workshop({
      venue: hall,
      venueId: hall.id,
      sessions: [session({ startsAt: '2027-05-22T08:00:00.000Z' })],
    });
    expect(workshopSortValue(row, 'name')).toBe('Demo Workshop 1');
    expect(workshopSortValue(row, 'category')).toBe('Technique');
    expect(workshopSortValue(row, 'level')).toBe('all');
    expect(workshopSortValue(row, 'capacity')).toBe(12);
    expect(workshopSortValue(row, 'duration')).toBe(120);
    expect(workshopSortValue(row, 'status')).toBe('published');
    expect(workshopSortValue(row, 'venue')).toBe(hall.name);
    expect(workshopSortValue(row, 'start')).toEqual(new Date('2027-05-22T08:00:00.000Z'));
    expect(workshopSortValue(row, 'nope')).toBeNull();
  });

  it('returns null for every empty column so sortRows sinks the row', () => {
    const row = workshop({ category: null, level: null, capacity: null, durationMinutes: null });
    expect(workshopSortValue(row, 'category')).toBeNull();
    expect(workshopSortValue(row, 'capacity')).toBeNull();
    expect(workshopSortValue(row, 'duration')).toBeNull();
    expect(workshopSortValue(row, 'start')).toBeNull();
    expect(workshopSortValue(row, 'venue')).toBeNull();
  });

  it('orders unscheduled workshops last in both directions', () => {
    const early = workshop({
      title: 'early',
      sessions: [session({ startsAt: '2027-05-22T08:00:00.000Z' })],
    });
    const late = workshop({
      title: 'late',
      sessions: [session({ startsAt: '2027-05-23T08:00:00.000Z' })],
    });
    const unscheduled = workshop({ title: 'unscheduled' });
    const rows = [unscheduled, late, early];

    expect(sortRows(rows, 'start', 'asc', workshopSortValue).map((r) => r.title)).toEqual([
      'early',
      'late',
      'unscheduled',
    ]);
    expect(sortRows(rows, 'start', 'desc', workshopSortValue).map((r) => r.title)).toEqual([
      'late',
      'early',
      'unscheduled',
    ]);
  });
});
