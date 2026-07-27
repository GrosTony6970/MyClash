/**
 * Partition the public events list into Live / Published / Past sections.
 *
 * This used to filter by a search query too. That moved server-side (see
 * event-filters.ts + GET /events), and keeping a client-side copy would have
 * been a silent behaviour fork: the server matches with Postgres ILIKE plus an
 * organisation-id prefilter, the client matched with JS `includes` over a
 * joined string. They disagree on accents and on the org path, and the symptom
 * is "the server returned 5 rows and the UI shows 0".
 *
 * The partition itself stays client-side on purpose: it is presentation
 * derived from `status`, and splitting one response beats three round trips.
 *
 * Kept dependency-free (no React, no imports) so the helper can be
 * unit-tested in isolation and reused if the layout ever changes.
 */

export interface PublicEventLike {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  city?: string | null;
  country?: string | null;
  organizations?: { name?: string | null; slug?: string | null; logo_url?: string | null } | null;
}

export interface PartitionedEvents<T extends PublicEventLike> {
  live: T[];
  published: T[];
  past: T[];
}

export function partitionEvents<T extends PublicEventLike>(events: T[]): PartitionedEvents<T> {
  return {
    live: events.filter((e) => e.status === 'running'),
    published: events.filter((e) => e.status === 'published'),
    past: events.filter((e) => e.status === 'completed'),
  };
}
