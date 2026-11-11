import { describe, expect, it } from 'vitest';
import type { WorkshopListItem } from '../../../../src/components/workshops/workshop-grouping';
import {
  filterOptions,
  filterWorkshops,
  NO_FILTERS,
  type WorkshopFilters,
} from './filter-workshops';

const TZ = 'Europe/Paris';

const ws = (
  id: string,
  over: Partial<WorkshopListItem> = {},
  startsAt: string | null = '2027-05-01T08:00:00Z',
): WorkshopListItem => ({
  id,
  slug: id,
  title: id,
  shortDescription: null,
  descriptionMd: null,
  category: null,
  level: null,
  weapon: null,
  language: null,
  color: null,
  coverImageUrl: null,
  capacity: null,
  durationMinutes: null,
  sessions: [
    {
      id: `${id}-s`,
      startsAt,
      endsAt: null,
      locationLabel: null,
      venue: null,
      area: null,
      capacity: null,
      confirmedCount: 0,
    },
  ],
  instructors: [],
  ...over,
});

const paul = { globalPersonId: 'gp-paul', displayName: 'Paul Martin' };
const otherPaul = { globalPersonId: 'gp-paul-2', displayName: 'Paul Martin' };
const guest = { globalPersonId: null, displayName: 'Anne Guest' };

const rows = [
  ws('dagger', { weapon: 'Dagger', level: 'beginner', instructors: [paul] }),
  ws('rapier', { weapon: 'Rapier', level: 'advanced', instructors: [otherPaul, guest] }),
  ws(
    'longsword',
    { weapon: 'Longsword', level: 'beginner', language: 'fr' },
    '2027-05-02T08:00:00Z',
  ),
  ws('talk', { level: 'all', instructors: [paul] }),
];

const keep = (f: Partial<WorkshopFilters>) =>
  filterWorkshops(rows, { ...NO_FILTERS, ...f }, TZ).map((w) => w.id);

describe('filterOptions', () => {
  it('offers each weapon once, by name, and skips a Workshop with none', () => {
    expect(filterOptions(rows, TZ).weapons).toEqual(['Dagger', 'Longsword', 'Rapier']);
  });

  it('offers each instructor once: two people with one name stay two; a line with no profile goes by its name', () => {
    expect(filterOptions(rows, TZ).instructors).toEqual([
      { value: 'name:Anne Guest', label: 'Anne Guest' },
      { value: 'gp-paul', label: 'Paul Martin' },
      { value: 'gp-paul-2', label: 'Paul Martin' },
    ]);
  });

  it('keeps the other lists in the order they always had', () => {
    const o = filterOptions(rows, TZ);
    expect(o.levels).toEqual(['beginner', 'advanced', 'all']);
    expect(o.languages).toEqual(['fr']);
    expect(o.categories).toEqual([]);
    expect(o.days.map((d) => d.key)).toEqual(['2027-05-01', '2027-05-02']);
  });
});

describe('filterWorkshops', () => {
  it('keeps everything with no choice made', () => {
    expect(keep({})).toEqual(['dagger', 'rapier', 'longsword', 'talk']);
  });

  it('keeps the Workshops of one weapon', () => {
    expect(keep({ weapon: 'Rapier' })).toEqual(['rapier']);
  });

  it('keeps the Workshops one person teaches, not their namesake', () => {
    expect(keep({ instructor: 'gp-paul' })).toEqual(['dagger', 'talk']);
    expect(keep({ instructor: 'name:Anne Guest' })).toEqual(['rapier']);
  });

  it('applies every choice together, the old ones as before', () => {
    expect(keep({ level: 'beginner' })).toEqual(['dagger', 'longsword']);
    expect(keep({ level: 'beginner', weapon: 'Dagger' })).toEqual(['dagger']);
    expect(keep({ day: '2027-05-02' })).toEqual(['longsword']);
    expect(keep({ language: 'fr' })).toEqual(['longsword']);
    expect(keep({ query: 'anne' })).toEqual(['rapier']);
    expect(keep({ instructor: 'gp-paul', weapon: 'Rapier' })).toEqual([]);
  });
});
