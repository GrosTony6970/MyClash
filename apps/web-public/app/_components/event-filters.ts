/**
 * Public-catalogue filter state, as a URL.
 *
 * The landing page stays a server component and reads `searchParams`, so a
 * filtered view is a shareable link and stays indexable. These helpers are the
 * boundary: parse validates and DROPS anything malformed, so a hand-edited or
 * link-rotted URL can never forward junk to the API.
 *
 * Dependency-free (no React, no imports) — sibling of filter-events.ts and
 * unit-testable in isolation.
 */

export interface EventFilters {
  q: string | null;
  country: string | null;
  weapon: string | null;
  from: string | null;
  to: string | null;
}

export const EMPTY_EVENT_FILTERS: EventFilters = {
  q: null,
  country: null,
  weapon: null,
  from: null,
  to: null,
};

type RawSearchParams = Record<string, string | string[] | undefined>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;
/** Matches the API's weapon slug shape; anything else is link rot. */
const WEAPON_SLUG = /^[a-z0-9-]{1,100}$/;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function parseEventFilters(params: RawSearchParams): EventFilters {
  const q = first(params['q']);
  const country = first(params['country']);
  const weapon = first(params['weapon']);
  const from = first(params['from']);
  const to = first(params['to']);

  // A reversed range is user error, not an attack — swap rather than drop, so
  // the results match what they plainly meant.
  const validFrom = from && ISO_DATE.test(from) ? from : null;
  const validTo = to && ISO_DATE.test(to) ? to : null;
  const swap = validFrom && validTo && validFrom > validTo;

  return {
    // Cap matches the API's own z.string().max(100).
    q: q ? q.slice(0, 100) : null,
    country: country && COUNTRY_CODE.test(country) ? country.toUpperCase() : null,
    weapon: weapon && WEAPON_SLUG.test(weapon) ? weapon : null,
    from: swap ? validTo : validFrom,
    to: swap ? validFrom : validTo,
  };
}

/** Serialize to a query string (no leading `?`); empty when nothing is set. */
export function toEventQueryString(filters: EventFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.country) params.set('country', filters.country);
  if (filters.weapon) params.set('weapon', filters.weapon);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

export function hasAnyFilter(filters: EventFilters): boolean {
  return Boolean(filters.q || filters.country || filters.weapon || filters.from || filters.to);
}
