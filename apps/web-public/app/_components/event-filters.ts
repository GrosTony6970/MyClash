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

/**
 * Which catalogue section is showing. Deliberately NOT a field of EventFilters:
 * the filter bar rebuilds the URL from toEventQueryString on every keystroke, so
 * a tab living inside the filter object would have to survive four call sites
 * that construct EventFilters literals (the Clear button among them). Carrying
 * it alongside keeps those exhaustive and makes the omission a type error rather
 * than a silent reset to Events.
 */
export type CatalogTab = 'events' | 'leagues' | 'fighters';

export const DEFAULT_CATALOG_TAB: CatalogTab = 'events';

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

/**
 * First usable string out of a searchParams entry that may arrive as an array.
 * Exported because every server page in this app has to do exactly this, and
 * /organisers grew a second copy with different semantics (`''` rather than
 * `null`, no trim) before this one was reachable.
 */
export function first(value: string | string[] | undefined): string | null {
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

/** Junk, a missing value and the default all resolve to the default tab. */
export function parseTab(value: string | string[] | undefined): CatalogTab {
  const raw = first(value);
  if (raw === 'leagues') return 'leagues';
  if (raw === 'fighters') return 'fighters';
  return DEFAULT_CATALOG_TAB;
}

/**
 * The catalogue URL, filters and tab together — the ONLY serializer any writer
 * should call.
 *
 * `toEventQueryString` alone is what the filter bar used to commit, and because
 * it cannot see the tab, every filter change and every debounced keystroke
 * silently rewrote the URL back to Events. Routing both writers (the filter bar
 * and the tab links) through one function makes "the tab survives a keystroke" a
 * property of the code rather than of whoever remembered to re-append it.
 *
 * The default tab is omitted so `/` stays the canonical, linkable address for
 * the catalogue — same convention as /me/profile's tabs.
 */
export function toCatalogQueryString(filters: EventFilters, tab: CatalogTab): string {
  const events = toEventQueryString(filters);
  if (tab === DEFAULT_CATALOG_TAB) return events;
  return events ? `${events}&tab=${tab}` : `tab=${tab}`;
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
