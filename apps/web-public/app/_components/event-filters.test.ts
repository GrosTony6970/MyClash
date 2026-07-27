import { describe, it, expect } from 'vitest';
import {
  parseEventFilters,
  toEventQueryString,
  hasAnyFilter,
  EMPTY_EVENT_FILTERS,
} from './event-filters';

describe('parseEventFilters', () => {
  it('reads every supported param', () => {
    expect(
      parseEventFilters({
        q: 'lyon',
        country: 'FR',
        weapon: 'longsword',
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    ).toEqual({
      q: 'lyon',
      country: 'FR',
      weapon: 'longsword',
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('returns all-null for an empty query string', () => {
    expect(parseEventFilters({})).toEqual(EMPTY_EVENT_FILTERS);
  });

  it('treats blank and whitespace-only values as absent', () => {
    expect(parseEventFilters({ q: '   ', country: '' })).toEqual(EMPTY_EVENT_FILTERS);
  });

  it('takes the first value when a param is repeated', () => {
    expect(parseEventFilters({ q: ['lyon', 'paris'] }).q).toBe('lyon');
  });

  it('drops a malformed country instead of forwarding it to the API', () => {
    expect(parseEventFilters({ country: 'FRA' }).country).toBeNull();
    expect(parseEventFilters({ country: '1' }).country).toBeNull();
    expect(parseEventFilters({ country: 'f1' }).country).toBeNull();
  });

  it('upper-cases a valid country code', () => {
    expect(parseEventFilters({ country: 'fr' }).country).toBe('FR');
  });

  it('drops a malformed date', () => {
    expect(parseEventFilters({ from: '01/06/2026' }).from).toBeNull();
    expect(parseEventFilters({ to: 'tomorrow' }).to).toBeNull();
  });

  it('drops a weapon slug that is not slug-shaped', () => {
    expect(parseEventFilters({ weapon: 'Long Sword' }).weapon).toBeNull();
    expect(parseEventFilters({ weapon: "longsword' OR 1=1" }).weapon).toBeNull();
    expect(parseEventFilters({ weapon: 'sword-buckler' }).weapon).toBe('sword-buckler');
  });

  it('swaps a reversed date range rather than dropping it', () => {
    // User error, not an attack — showing them nothing would be unhelpful.
    const parsed = parseEventFilters({ from: '2026-06-30', to: '2026-06-01' });
    expect(parsed.from).toBe('2026-06-01');
    expect(parsed.to).toBe('2026-06-30');
  });

  it('leaves a single-sided range alone', () => {
    expect(parseEventFilters({ from: '2026-06-30' })).toMatchObject({
      from: '2026-06-30',
      to: null,
    });
  });

  it('caps an overlong q at the API limit', () => {
    expect(parseEventFilters({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });

  it('ignores unknown params', () => {
    expect(parseEventFilters({ evil: 'x', q: 'lyon' })).toEqual({
      ...EMPTY_EVENT_FILTERS,
      q: 'lyon',
    });
  });
});

describe('toEventQueryString', () => {
  it('round-trips through parse', () => {
    const filters = {
      q: 'lyon amhe',
      country: 'FR',
      weapon: 'longsword',
      from: '2026-06-01',
      to: '2026-06-30',
    };
    const qs = toEventQueryString(filters);
    expect(parseEventFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(filters);
  });

  it('is empty when nothing is set', () => {
    expect(toEventQueryString(EMPTY_EVENT_FILTERS)).toBe('');
  });

  it('omits unset keys rather than emitting empties', () => {
    expect(toEventQueryString({ ...EMPTY_EVENT_FILTERS, q: 'lyon' })).toBe('q=lyon');
  });

  it('encodes values that need it', () => {
    expect(toEventQueryString({ ...EMPTY_EVENT_FILTERS, q: 'a&b=c' })).toBe('q=a%26b%3Dc');
  });
});

describe('hasAnyFilter', () => {
  it('is false for empty filters', () => {
    expect(hasAnyFilter(EMPTY_EVENT_FILTERS)).toBe(false);
  });

  it('is true when any single filter is set', () => {
    for (const key of ['q', 'country', 'weapon', 'from', 'to'] as const) {
      expect(hasAnyFilter({ ...EMPTY_EVENT_FILTERS, [key]: 'x' })).toBe(true);
    }
  });
});
