import { describe, expect, it } from 'vitest';
import { buildSitemapEntries, EMPTY_SITEMAP_SOURCES } from './sitemap-entries';
import { buildRobotsRules } from './robots-rules';

const ORIGIN = 'https://app.myclash.fr';

const SOURCES = {
  events: [
    { slug: 'lyon-open-2026', start_date: '2026-06-01', end_date: '2026-06-02' },
    { slug: 'paris-cup-2024', start_date: '2024-03-10', end_date: '2024-03-11' },
  ],
  leagues: [{ slug: 'ligue-aura' }],
  organizers: [{ slug: 'garde-noire' }],
};

function urls(sources = SOURCES): string[] {
  return buildSitemapEntries(ORIGIN, sources).map((entry) => entry.url);
}

describe('buildSitemapEntries', () => {
  it('emits absolute URLs on the configured origin', () => {
    // A relative entry is silently dropped by every crawler, so an entire
    // sitemap can be "delivered" and index nothing.
    for (const url of urls()) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    }
  });

  it('includes the catalogue and the organiser hub with no data at all', () => {
    // The static routes must not depend on a fetch succeeding: an API outage
    // during a revalidate would otherwise publish an empty sitemap.
    expect(urls(EMPTY_SITEMAP_SOURCES)).toEqual([`${ORIGIN}/`, `${ORIGIN}/organisers`]);
  });

  it('includes PAST events, not only upcoming ones', () => {
    // A finished event's results are the most durable thing this platform
    // publishes and what people search for months later.
    expect(urls()).toContain(`${ORIGIN}/e/paris-cup-2024`);
  });

  it('includes leagues and organisers', () => {
    expect(urls()).toContain(`${ORIGIN}/leagues/ligue-aura`);
    expect(urls()).toContain(`${ORIGIN}/o/garde-noire`);
  });

  it('skips rows with no slug rather than emitting a bare collection URL', () => {
    // `${origin}/e/` would be a 404 in the sitemap, which crawlers count
    // against the whole map.
    const built = urls({
      events: [{ slug: null }, { slug: '' }, { slug: undefined }],
      leagues: [{ slug: null }],
      organizers: [{ slug: null }],
    });
    expect(built).toEqual([`${ORIGIN}/`, `${ORIGIN}/organisers`]);
  });

  it('dedupes a slug that arrives twice', () => {
    const built = urls({
      ...SOURCES,
      events: [...SOURCES.events, { slug: 'lyon-open-2026' }],
    });
    expect(built.filter((u) => u.endsWith('/e/lyon-open-2026'))).toHaveLength(1);
  });

  it('carries a real lastModified, or none at all', () => {
    // An Invalid Date serializes to null and invalidates the entry; better to
    // omit the field than to emit a broken one.
    for (const entry of buildSitemapEntries(ORIGIN, {
      ...EMPTY_SITEMAP_SOURCES,
      events: [{ slug: 'a', start_date: 'not-a-date', end_date: null }],
    })) {
      if (entry.lastModified !== undefined) {
        expect(Number.isNaN(entry.lastModified.getTime())).toBe(false);
      }
    }
  });

  it('lists no URL that robots disallows', () => {
    // A URL that is both mapped and disallowed is a contradiction crawlers
    // report as an error. These two files have to agree, and this is the only
    // place that checks they do.
    const [rule] = buildRobotsRules(ORIGIN).rules;
    for (const url of urls()) {
      const path = new URL(url).pathname;
      for (const blocked of rule?.disallow ?? []) {
        expect(path.startsWith(blocked) && blocked !== '/').toBe(false);
      }
    }
  });

  it('lists no personal-space or auth URL', () => {
    for (const url of urls()) {
      const path = new URL(url).pathname;
      for (const forbidden of ['/me', '/login', '/reset-password', '/notifications']) {
        expect(path.startsWith(forbidden)).toBe(false);
      }
    }
  });
});
