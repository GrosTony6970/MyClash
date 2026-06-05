import { describe, expect, it } from 'vitest';
import { partitionAndFilterEvents, type PublicEventLike } from './filter-events';

const ev = (overrides: Partial<PublicEventLike>): PublicEventLike => ({
  id: overrides.id ?? 'e1',
  name: overrides.name ?? '',
  status: overrides.status ?? 'published',
  city: overrides.city ?? null,
  country: overrides.country ?? null,
  organizations: overrides.organizations ?? null,
  ...overrides,
});

describe('partitionAndFilterEvents', () => {
  it('splits events into live / published / past by status', () => {
    const out = partitionAndFilterEvents(
      [
        ev({ id: 'r', status: 'running' }),
        ev({ id: 'p', status: 'published' }),
        ev({ id: 'c', status: 'completed' }),
      ],
      '',
    );
    expect(out.live.map((e) => e.id)).toEqual(['r']);
    expect(out.published.map((e) => e.id)).toEqual(['p']);
    expect(out.past.map((e) => e.id)).toEqual(['c']);
  });

  it('matches the query case-insensitively against name + city + country + org name', () => {
    const out = partitionAndFilterEvents(
      [
        ev({ id: 'a', status: 'published', name: 'Lyon Spring' }),
        ev({ id: 'b', status: 'published', city: 'Paris' }),
        ev({
          id: 'c',
          status: 'published',
          organizations: { name: 'LYON AMHE', slug: 'l', logo_url: null },
        }),
        ev({ id: 'd', status: 'published', name: 'Other' }),
      ],
      'lyon',
    );
    expect(out.published.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('matches against the country code so operators can search "FR"', () => {
    const out = partitionAndFilterEvents(
      [
        ev({ id: 'a', status: 'published', country: 'FR' }),
        ev({ id: 'b', status: 'published', country: 'DE' }),
      ],
      'fr',
    );
    expect(out.published.map((e) => e.id)).toEqual(['a']);
  });

  it('trims whitespace from the query', () => {
    const out = partitionAndFilterEvents(
      [ev({ id: 'a', status: 'published', name: 'Lyon Spring' })],
      '   lyon   ',
    );
    expect(out.published.map((e) => e.id)).toEqual(['a']);
  });

  it('returns all events for the empty query', () => {
    const list = [ev({ id: 'a', status: 'published' }), ev({ id: 'b', status: 'completed' })];
    const out = partitionAndFilterEvents(list, '');
    expect(out.published.length + out.past.length).toBe(2);
  });
});
