import type { MetadataRoute } from 'next';
import { getServerApiUrl } from '@/lib/api-url';
import { getAppOrigin } from '@/lib/app-origin';
import { buildSitemapEntries, EMPTY_SITEMAP_SOURCES, type SitemapSources } from './sitemap-entries';

/**
 * `/sitemap.xml`.
 *
 * ── Why dynamic, with cached fetches ────────────────────────────────────────
 * The ROUTE must render at runtime: `PUBLIC_APP_ORIGIN` is set in the
 * container's `environment:` and does not exist during `docker build`, so a
 * prerendered sitemap would ship every URL rooted at `http://localhost:3001` —
 * and the API is not running at build time either, so it would ship empty as
 * well. Both are served until the first revalidation, which is exactly the
 * window a crawler uses.
 *
 * The DATA is still cached for an hour. A crawler hits this after every ping and
 * the queries behind it scan every published event, league and organiser; at
 * `no-store` a badly-behaved bot could keep three list endpoints permanently
 * busy. `fetchCache` re-enables caching that `force-dynamic` would otherwise
 * turn off, so the per-fetch `revalidate` below is what actually applies.
 *
 * Every fetch degrades to an empty list rather than throwing. A sitemap missing
 * its leagues is a smaller problem than a 500 at `/sitemap.xml`, which crawlers
 * treat as "the whole map is gone" and can drop already-indexed URLs over.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-cache';

const REVALIDATE_SECONDS = 3600;

const ORG_PAGE_SIZE = 50;
/**
 * Hard stop on the organiser walk. A paginated fetch driven by a `total` the
 * server controls is an unbounded loop from this side; this bounds it at 5000
 * organisers, far beyond any plausible roster, so a bad `total` costs a hundred
 * requests rather than an infinite build.
 */
const MAX_ORG_PAGES = 100;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) {
      console.error('[sitemap] non-OK', { url, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error('[sitemap] fetch threw', {
      url,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return null;
  }
}

/** `GET /events` already returns published, running AND completed events. */
async function fetchEvents(apiUrl: string): Promise<SitemapSources['events']> {
  return (await fetchJson<SitemapSources['events']>(`${apiUrl}/api/v1/events`)) ?? [];
}

async function fetchLeagues(apiUrl: string): Promise<SitemapSources['leagues']> {
  return (await fetchJson<SitemapSources['leagues']>(`${apiUrl}/api/v1/leagues`)) ?? [];
}

/** `/organizations/public` is paginated and caps `limit`, so walk it. */
async function fetchOrganizers(apiUrl: string): Promise<SitemapSources['organizers']> {
  const all: SitemapSources['organizers'] = [];
  for (let page = 0; page < MAX_ORG_PAGES; page += 1) {
    const offset = page * ORG_PAGE_SIZE;
    const body = await fetchJson<{ items: SitemapSources['organizers']; total: number }>(
      `${apiUrl}/api/v1/organizations/public?limit=${ORG_PAGE_SIZE}&offset=${offset}`,
    );
    // A failed page ends the walk with what we have. Retrying would risk the
    // route timing out, and a partial sitemap still refreshes on the next
    // revalidate.
    if (!body?.items?.length) break;
    all.push(...body.items);
    if (all.length >= body.total) break;
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const apiUrl = getServerApiUrl();
  const [events, leagues, organizers] = await Promise.all([
    fetchEvents(apiUrl),
    fetchLeagues(apiUrl),
    fetchOrganizers(apiUrl),
  ]);

  return buildSitemapEntries(getAppOrigin(), {
    ...EMPTY_SITEMAP_SOURCES,
    events,
    leagues,
    organizers,
  });
}
