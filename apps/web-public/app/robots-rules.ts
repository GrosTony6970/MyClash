/**
 * The crawl policy, as data.
 *
 * Pure and dependency-free so the policy can be asserted in a unit test rather
 * than read off a generated file: "is /me disallowed?" is a question with a
 * right answer, and the answer should not depend on booting Next.
 *
 * ── What is allowed, and why ────────────────────────────────────────────────
 * Everything public and linkable: the catalogue (`/`), events (`/e/*`), leagues,
 * organisers, clubs and fighter profiles. These are the pages the platform
 * exists to publish.
 *
 * ── What is disallowed, and why ─────────────────────────────────────────────
 * Personal space and the auth routes. Not because they leak — they require a
 * session — but because a crawler that fetches them gets a login redirect and
 * indexes THAT, so the login page ends up ranking for a competitor's name.
 * The display routes are TV output: chromeless, meaningless out of context, and
 * they poll.
 *
 * ── What is deliberately NOT disallowed ─────────────────────────────────────
 * `/fighters/`. A `Disallow` is not a `noindex`: it stops the crawler
 * FETCHING the page, so it never reads the per-profile `robots` meta tag that
 * decides whether that particular fighter opted into indexing. A blanket
 * disallow would freeze every profile in whatever state Google already had, and
 * make opting in impossible. The per-page tag is the mechanism; this file must
 * leave it reachable.
 */

export interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

export interface RobotsRules {
  rules: RobotsRule[];
  sitemap: string;
  host: string;
}

/**
 * Paths kept out of the index. Prefixes, matched by the crawler as such — so
 * `/me` covers `/me/profile`, `/me/follows` and everything below.
 */
const DISALLOWED = [
  '/me',
  '/login',
  '/reset-password',
  '/notifications',
  '/auth/',
  // TV / kiosk output. Chromeless by design and useless as a search result.
  '/display',
  // Next's own internals: never useful, and they burn crawl budget.
  '/api/',
  '/_next/',
];

export function buildRobotsRules(origin: string): RobotsRules {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [...DISALLOWED],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
