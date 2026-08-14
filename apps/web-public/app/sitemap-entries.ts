/**
 * The sitemap, as data.
 *
 * Pure and dependency-free: the questions worth asking of a sitemap ("is /me in
 * it?", "are these absolute?", "is this fighter listed?") should be answerable
 * in a unit test rather than by generating XML and reading it.
 *
 * ── What goes in ────────────────────────────────────────────────────────────
 * Every public, linkable entity, PAST EVENTS INCLUDED. A finished event's
 * results are the most durable content this platform has — they are what people
 * search for months later — so excluding them would drop the majority of what
 * is worth finding.
 *
 * ── What stays out ──────────────────────────────────────────────────────────
 * Anything `robots-rules.ts` disallows. A URL that is both in the sitemap and
 * disallowed is a contradiction crawlers report as an error, so the two files
 * have to agree; `sitemap-entries.test.ts` asserts they do.
 *
 * ── What is missing, and why ────────────────────────────────────────────────
 * Club pages. `/clubs/[slug]` is public and crawlable, but there is no public
 * clubs LIST endpoint to enumerate from (`GET /clubs/:slug` is the only public
 * club route). They stay reachable through the event and fighter pages that
 * link to them; adding them here needs an API endpoint that does not exist yet.
 */

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

/** Only the fields this module reads — callers pass whatever their fetch returned. */
export interface SitemapSources {
  events: Array<{ slug?: string | null; end_date?: string | null; start_date?: string | null }>;
  leagues: Array<{ slug?: string | null }>;
  organizers: Array<{ slug?: string | null }>;
}

export const EMPTY_SITEMAP_SOURCES: SitemapSources = {
  events: [],
  leagues: [],
  organizers: [],
};

/**
 * Routes that exist regardless of what is in the database.
 *
 * `/` outranks everything: it is the catalogue, and it is the page an operator
 * hands out. `/organisers` is a hub, so it is next.
 */
const STATIC_ROUTES: ReadonlyArray<{
  path: string;
  priority: number;
  changeFrequency: SitemapEntry['changeFrequency'];
}> = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/organisers', priority: 0.6, changeFrequency: 'weekly' },
];

/** Parse an ISO date without throwing on the junk a nullable column can hold. */
function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function buildSitemapEntries(origin: string, sources: SitemapSources): SitemapEntry[] {
  const entries: SitemapEntry[] = STATIC_ROUTES.map((route) => ({
    url: `${origin}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Deduped by URL: a slug can legitimately repeat across pages of a paginated
  // fetch, and a crawler reads a repeat as a malformed map.
  const seen = new Set(entries.map((entry) => entry.url));
  function push(path: string, entry: Omit<SitemapEntry, 'url'>) {
    const url = `${origin}${path}`;
    if (seen.has(url)) return;
    seen.add(url);
    entries.push({ url, ...entry });
  }

  for (const event of sources.events) {
    if (!event.slug) continue;
    push(`/e/${event.slug}`, {
      // An event's page changes constantly while it runs and never afterwards,
      // but `lastModified` already carries that signal; a single honest value
      // beats guessing per row.
      lastModified: toDate(event.end_date) ?? toDate(event.start_date),
      changeFrequency: 'daily',
      priority: 0.8,
    });
  }

  for (const league of sources.leagues) {
    if (!league.slug) continue;
    push(`/leagues/${league.slug}`, { changeFrequency: 'weekly', priority: 0.7 });
  }

  for (const organizer of sources.organizers) {
    if (!organizer.slug) continue;
    push(`/o/${organizer.slug}`, { changeFrequency: 'weekly', priority: 0.6 });
  }

  return entries;
}
