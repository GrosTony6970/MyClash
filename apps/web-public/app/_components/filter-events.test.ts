import { describe, expect, it } from 'vitest';
import { partitionEvents, type PublicEventLike } from './filter-events';

const ev = (overrides: Partial<PublicEventLike>): PublicEventLike => ({
  id: overrides.id ?? 'e1',
  name: overrides.name ?? '',
  status: overrides.status ?? 'published',
  city: overrides.city ?? null,
  country: overrides.country ?? null,
  organizations: overrides.organizations ?? null,
  ...overrides,
});

// The query-matching tests that used to live here are gone with the behaviour:
// filtering moved server-side to GET /events, and a second client-side
// implementation would only be able to disagree with it. Parsing/serializing
// the filter URL is covered by event-filters.test.ts.
describe('partitionEvents', () => {
  it('splits events into live / published / past by status', () => {
    const out = partitionEvents([
      ev({ id: 'r', status: 'running' }),
      ev({ id: 'p', status: 'published' }),
      ev({ id: 'c', status: 'completed' }),
    ]);
    expect(out.live.map((e) => e.id)).toEqual(['r']);
    expect(out.published.map((e) => e.id)).toEqual(['p']);
    expect(out.past.map((e) => e.id)).toEqual(['c']);
  });

  it('preserves the order the server returned within each section', () => {
    const out = partitionEvents([
      ev({ id: 'p2', status: 'published' }),
      ev({ id: 'p1', status: 'published' }),
    ]);
    expect(out.published.map((e) => e.id)).toEqual(['p2', 'p1']);
  });

  it('drops statuses that belong to no section', () => {
    // draft / archived never reach the public list, but the partition must not
    // silently file them under one of the three headings if they ever do.
    const out = partitionEvents([
      ev({ id: 'd', status: 'draft' }),
      ev({ id: 'a', status: 'archived' }),
      ev({ id: 'p', status: 'published' }),
    ]);
    expect(out.live.length + out.past.length).toBe(0);
    expect(out.published.map((e) => e.id)).toEqual(['p']);
  });

  it('returns three empty sections for an empty list', () => {
    expect(partitionEvents([])).toEqual({ live: [], published: [], past: [] });
  });
});
