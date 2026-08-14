import { describe, it, expect } from 'vitest';
import {
  parseEventFilters,
  parseTab,
  toCatalogQueryString,
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

describe('parseTab', () => {
  it('defaults to events when absent', () => {
    expect(parseTab(undefined)).toBe('events');
  });

  it('reads every real tab', () => {
    expect(parseTab('leagues')).toBe('leagues');
    expect(parseTab('fighters')).toBe('fighters');
  });

  it('drops junk rather than rendering an empty catalogue', () => {
    // A hand-edited or link-rotted ?tab= must land somewhere real. Falling back
    // to the default beats matching nothing and rendering neither panel.
    for (const junk of ['organisers', 'Leagues', '', '  ', 'events;drop']) {
      expect(parseTab(junk)).toBe('events');
    }
  });

  it('takes the first value when the param repeats', () => {
    expect(parseTab(['leagues', 'events'])).toBe('leagues');
  });
});

describe('toCatalogQueryString', () => {
  it('omits the default tab so / stays the canonical address', () => {
    expect(toCatalogQueryString(EMPTY_EVENT_FILTERS, 'events')).toBe('');
    expect(toCatalogQueryString({ ...EMPTY_EVENT_FILTERS, q: 'lyon' }, 'events')).toBe('q=lyon');
  });

  it('emits a non-default tab with no filters', () => {
    expect(toCatalogQueryString(EMPTY_EVENT_FILTERS, 'leagues')).toBe('tab=leagues');
  });

  it('keeps the tab when a filter changes', () => {
    // The filter bar rebuilds the ENTIRE query string on every commit. Before
    // this function existed it rebuilt it from toEventQueryString alone, so
    // picking a country while on the Leagues tab threw the reader back to
    // Events. This is the assertion that fails if that regresses.
    const committed = toCatalogQueryString({ ...EMPTY_EVENT_FILTERS, country: 'FR' }, 'leagues');
    expect(committed).toContain('tab=leagues');
    expect(parseTab(Object.fromEntries(new URLSearchParams(committed))['tab'])).toBe('leagues');
  });

  it('keeps the tab across every keystroke of a search', () => {
    // The search box debounces and commits per character. One dropped tab on
    // any single keystroke is indistinguishable from dropping it on all of them.
    for (const q of ['l', 'ly', 'lyo', 'lyon']) {
      const committed = toCatalogQueryString({ ...EMPTY_EVENT_FILTERS, q }, 'leagues');
      const params = Object.fromEntries(new URLSearchParams(committed));
      expect(parseTab(params['tab'])).toBe('leagues');
      expect(params['q']).toBe(q);
    }
  });

  it('round-trips filters and tab together', () => {
    const filters = {
      q: 'lyon amhe',
      country: 'FR',
      weapon: 'longsword',
      from: '2026-06-01',
      to: '2026-06-30',
    };
    const params = Object.fromEntries(
      new URLSearchParams(toCatalogQueryString(filters, 'leagues')),
    );
    expect(parseEventFilters(params)).toEqual(filters);
    expect(parseTab(params['tab'])).toBe('leagues');
  });
});

describe('the browser-URL writers all go through toCatalogQueryString', () => {
  // Not a style rule. `toEventQueryString` cannot see the tab, so ANY writer
  // that builds a browser URL from it erases ?tab= — the filter bar did this on
  // every keystroke. The pure tests above prove the serializer keeps the tab;
  // only this proves the two callers actually use it. There is no jsdom in this
  // app, so reading the source is the cheapest honest check.
  const WRITERS = ['EventFilterBar.tsx', 'HomeTabs.tsx'] as const;

  for (const file of WRITERS) {
    it(`${file} builds its URL from toCatalogQueryString`, async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

      expect(source).toContain('toCatalogQueryString');
      expect(source).not.toContain('toEventQueryString');
    });
  }
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
