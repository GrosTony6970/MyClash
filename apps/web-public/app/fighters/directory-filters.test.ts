import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRECTORY_FILTERS,
  directoryHref,
  hasAnyDirectoryFilter,
  parseDirectoryFilters,
  toDirectoryQueryString,
  toggleSort,
  withFilter,
} from './directory-filters';

describe('parseDirectoryFilters', () => {
  it('reads every supported param', () => {
    expect(
      parseDirectoryFilters({
        q: 'kuntz',
        club: 'garde',
        country: 'fr',
        weapon: 'longsword',
        sort: 'club',
        dir: 'desc',
        offset: '48',
      }),
    ).toEqual({
      q: 'kuntz',
      club: 'garde',
      country: 'FR',
      weapon: 'longsword',
      sort: 'club',
      dir: 'desc',
      offset: 48,
    });
  });

  it('defaults an empty query to name-ascending, first page', () => {
    expect(parseDirectoryFilters({})).toEqual(DEFAULT_DIRECTORY_FILTERS);
  });

  it('drops junk rather than forwarding it to the API', () => {
    // The API DTO is .strict() with enums, so a forwarded bad value is a 400
    // and a blank page. Dropping it here means a link-rotted URL degrades to
    // the default view instead.
    const parsed = parseDirectoryFilters({
      country: 'FRA',
      weapon: "longsword' OR 1=1",
      sort: 'email',
      dir: 'sideways',
      offset: '-5',
    });
    expect(parsed.country).toBeNull();
    expect(parsed.weapon).toBeNull();
    expect(parsed.sort).toBe('name');
    expect(parsed.dir).toBe('asc');
    expect(parsed.offset).toBe(0);
  });

  it('ignores unknown params', () => {
    expect(parseDirectoryFilters({ evil: 'x', q: 'kuntz' })).toEqual({
      ...DEFAULT_DIRECTORY_FILTERS,
      q: 'kuntz',
    });
  });

  it('takes the first value when a param repeats, and caps overlong text', () => {
    expect(parseDirectoryFilters({ q: ['a', 'b'] }).q).toBe('a');
    expect(parseDirectoryFilters({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });

  it('treats whitespace-only as absent', () => {
    expect(parseDirectoryFilters({ q: '   ', club: '\t' })).toEqual(DEFAULT_DIRECTORY_FILTERS);
  });
});

describe('toDirectoryQueryString', () => {
  it('is empty at the defaults, so /fighters stays canonical', () => {
    expect(toDirectoryQueryString(DEFAULT_DIRECTORY_FILTERS)).toBe('');
    expect(directoryHref(DEFAULT_DIRECTORY_FILTERS)).toBe('/fighters');
  });

  it('round-trips through parse', () => {
    const filters = {
      q: 'kuntz',
      club: 'garde noire',
      country: 'FR',
      weapon: 'longsword',
      sort: 'country' as const,
      dir: 'desc' as const,
      offset: 24,
    };
    const params = Object.fromEntries(new URLSearchParams(toDirectoryQueryString(filters)));
    expect(parseDirectoryFilters(params)).toEqual(filters);
  });

  it('composes filters with AND, and clearing one leaves the others', () => {
    const both = withFilter(
      withFilter(DEFAULT_DIRECTORY_FILTERS, 'country', 'FR'),
      'weapon',
      'longsword',
    );
    expect(toDirectoryQueryString(both)).toContain('country=FR');
    expect(toDirectoryQueryString(both)).toContain('weapon=longsword');

    const cleared = withFilter(both, 'country', null);
    expect(toDirectoryQueryString(cleared)).not.toContain('country');
    expect(toDirectoryQueryString(cleared)).toContain('weapon=longsword');
  });
});

describe('toggleSort', () => {
  it('starts a new column ascending', () => {
    const next = toggleSort(DEFAULT_DIRECTORY_FILTERS, 'club');
    expect(next.sort).toBe('club');
    expect(next.dir).toBe('asc');
  });

  it('flips direction on the active column', () => {
    const asc = toggleSort(DEFAULT_DIRECTORY_FILTERS, 'club');
    expect(toggleSort(asc, 'club').dir).toBe('desc');
    expect(toggleSort(toggleSort(asc, 'club'), 'club').dir).toBe('asc');
  });

  it('resets the offset, because page 3 of the old order is meaningless', () => {
    // Keeping it strands the reader on a page that may not exist under the new
    // ordering, which reads as an empty directory.
    const deep = { ...DEFAULT_DIRECTORY_FILTERS, offset: 72 };
    expect(toggleSort(deep, 'club').offset).toBe(0);
    expect(withFilter(deep, 'country', 'FR').offset).toBe(0);
  });
});

describe('hasAnyDirectoryFilter', () => {
  it('ignores sort and paging, which are not filters', () => {
    expect(hasAnyDirectoryFilter(DEFAULT_DIRECTORY_FILTERS)).toBe(false);
    expect(hasAnyDirectoryFilter({ ...DEFAULT_DIRECTORY_FILTERS, sort: 'club', offset: 24 })).toBe(
      false,
    );
  });

  it('is true for each filter in turn', () => {
    for (const key of ['q', 'club', 'country', 'weapon'] as const) {
      expect(hasAnyDirectoryFilter({ ...DEFAULT_DIRECTORY_FILTERS, [key]: 'x' })).toBe(true);
    }
  });
});
