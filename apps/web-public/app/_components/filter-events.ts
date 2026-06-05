/**
 * Slice 1 of the public microsite overhaul: partition the public events
 * list into Live / Published / Past sections, applying the same
 * search query to all three.
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

export function partitionAndFilterEvents<T extends PublicEventLike>(
  events: T[],
  rawQuery: string,
): PartitionedEvents<T> {
  const needle = rawQuery.trim().toLowerCase();
  const matches = (e: T) => {
    if (needle === '') return true;
    const haystack = [e.name, e.city, e.country, e.organizations?.name]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  };
  return {
    live: events.filter((e) => e.status === 'running').filter(matches),
    published: events.filter((e) => e.status === 'published').filter(matches),
    past: events.filter((e) => e.status === 'completed').filter(matches),
  };
}
