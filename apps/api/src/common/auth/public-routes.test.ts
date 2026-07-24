/**
 * public-routes.test.ts — the @Public() surface, read from the real decorators.
 *
 * WHY THIS EXISTS: this repo has a demonstrated habit of declarations drifting
 * from the behaviour they describe, with nothing checking —
 * check-api-route-security.mjs declared postures it never verified (7 turned out
 * false); assignment-board.service.ts cites a "scorekeeper check" that was never
 * written; EventReadOnlyGuard resolves params['matchId'] on routes that are all
 * matches/:id, so its branch is dead and it fails open. A hand-maintained list of
 * public routes would rot the same way.
 *
 * So this does not read a list — it reflects the ACTUAL decorator metadata Nest
 * will use at runtime, and pins it. Adding @Public() to a route is a deliberate
 * decision to expose it to the internet; this makes that decision show up as a
 * reviewed diff instead of a silent one-line change.
 *
 * Two assertions:
 *   1. the exact set of @Public() routes matches the reviewed snapshot below
 *   2. no @Public() route uses a destructive verb (the invariant that matters)
 */

import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from './public.decorator';

const VERB: Record<number, string> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  5: 'ALL',
  6: 'OPTIONS',
  7: 'HEAD',
};

/**
 * Every route reachable without an identity once AUTH_GUARD_MODE=enforce.
 *
 * Each entry is backed by a caller that sends no credentials — see the commit
 * history for the per-route evidence. If this test fails, you either exposed a
 * route to the internet or stopped exposing one: make sure that is what you
 * meant, then update this list in the same commit.
 */
const EXPECTED_PUBLIC = [
  // ── identity discovery: must answer `anonymous` with a 200, never 401 ──
  'GET /auth/me',
  'GET /me',
  // ── pre-session bootstrap: the caller has no identity yet, by definition ──
  'GET /auth/callback',
  'GET /auth/check-slug',
  'GET /auth/signup-callback',
  'POST /auth/logout',
  'POST /auth/magic-link',
  'POST /auth/oauth/session',
  'POST /auth/password-login',
  'POST /auth/public-login',
  'POST /auth/public-password-reset',
  'POST /auth/public-password-reset-confirm',
  'POST /auth/public-signup',
  'POST /auth/signup',
  'POST /events/:eventId/guest-sessions', // mints the guest cookie
  'POST /staff-auth/login', // mints the staff cookie — web-scoring dies without it
  'POST /staff-auth/logout', // idempotent; reads no identity
  // ── ops ──
  'GET /health', // docker healthcheck + deploy/rollback smoke tests
  'GET /public/feature-flags', // polled by every app before login
  // ── public event site (web-public, logged out) ──
  'GET /clubs/:slug',
  'GET /events',
  'GET /events/:eventId/lices',
  'GET /events/:eventId/live-state',
  'GET /events/:eventId/people/:personId/schedule',
  'GET /events/:eventId/persons/lookup',
  'GET /events/:eventId/programme',
  'GET /events/:eventId/schedule',
  'GET /events/:eventId/tournaments',
  'GET /events/:eventSlug/lices/:liceName/current',
  'GET /events/:eventSlug/participants',
  'GET /events/:eventSlug/public-workshops',
  'GET /events/:eventSlug/tournaments/:tournamentSlug/pools-with-matches',
  'GET /events/:eventSlug/tournaments/:tournamentSlug/standings',
  'GET /events/:slug',
  'GET /events/slug/:eventSlug/venues',
  'GET /fighters/:slug',
  'GET /fighters/:slug/career',
  'GET /fighters/:slug/matches',
  'GET /fighters/:slug/rating-history',
  'GET /fighters/:slug/referee-stats',
  'GET /leagues',
  'GET /leagues/:leagueId/club-standings',
  'GET /leagues/:leagueId/final-report.csv',
  'GET /leagues/:leagueId/final-report.print.html',
  'GET /leagues/:leagueId/member-events',
  'GET /leagues/:leagueId/standings',
  'GET /leagues/:slug',
  'GET /matches/:id',
  'GET /matches/:id/display',
  'GET /matches/:id/exchanges',
  'GET /matches/:id/penalties',
  'GET /matches/:id/summary',
  'GET /public/generated-content/:type/:entityId',
  'GET /tournaments/:id/stats/fighters',
  'GET /tournaments/:id/stats/overview',
  'GET /tournaments/:id/stats/target-values',
  'GET /tournaments/:tournamentId/pool-standings',
  'GET /workshops/slug/:slug',
].sort();

/**
 * A public route may read. It may not destroy.
 *
 * POST is allowed only for the bootstrap routes that mint a session or are
 * idempotent — enumerated, never a blanket. DELETE/PUT/PATCH are never allowed:
 * that rule alone would have blocked the 33 unauthenticated mutating routes this
 * work exists to close, among them DELETE /events/:eventId/programme/full and
 * DELETE /registrations/:id.
 */
const PUBLIC_POST_ALLOWLIST = new Set([
  'POST /auth/logout',
  'POST /auth/magic-link',
  'POST /auth/oauth/session',
  'POST /auth/password-login',
  'POST /auth/public-login',
  'POST /auth/public-password-reset',
  'POST /auth/public-password-reset-confirm',
  'POST /auth/public-signup',
  'POST /auth/signup',
  'POST /events/:eventId/guest-sessions',
  'POST /staff-auth/login',
  'POST /staff-auth/logout',
]);

type Row = { route: string; verb: string; isPublic: boolean };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * Deliberately fs + dynamic import rather than `import.meta.glob`: the glob is a
 * vitest-only feature, and `nest build` compiles this file too (that is why the
 * repo builds the API rather than trusting `tsc --noEmit`). A glob here passes
 * the test run and breaks the Docker build.
 */
async function collectRoutes(): Promise<Row[]> {
  const files = controllerFiles(join(__dirname, '..', '..', 'modules'));
  const rows: Row[] = [];

  for (const file of files) {
    // Plain absolute path with forward slashes — NOT pathToFileURL: this repo's
    // checkout path contains a space, which the file:// URL percent-encodes and
    // vitest's resolver then fails to load.
    const mod = (await import(file.split(sep).join('/'))) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || !(exported as { prototype?: object }).prototype) {
        continue;
      }
      const cls = exported as { prototype: object };
      const prefix = Reflect.getMetadata(PATH_METADATA, exported) as string | undefined;
      if (prefix === undefined) continue; // not a @Controller

      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true;

      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === 'constructor') continue;
        const handler = (cls.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue; // not a route

        const verb = VERB[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'UNKNOWN';
        const full = `/${[prefix, path].filter((p) => p && p !== '/').join('/')}`.replace(
          /\/+/g,
          '/',
        );
        rows.push({
          route: `${verb} ${full}`,
          verb,
          isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        });
      }
    }
  }
  return rows;
}

describe('@Public() route surface', () => {
  let rows: Row[] = [];

  beforeAll(async () => {
    rows = await collectRoutes();
  }, 60_000);

  it('finds the controller metadata at all (guards the reflection itself)', () => {
    // If this breaks, every other assertion here silently passes on an empty set.
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.some((r) => r.route === 'GET /health')).toBe(true);
  });

  it('exposes exactly the reviewed set of routes to anonymous callers', () => {
    const actual = rows
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();
    expect(actual).toEqual(EXPECTED_PUBLIC);
  });

  it('never exposes a destructive verb publicly', () => {
    const destructive = rows
      .filter((r) => r.isPublic && ['DELETE', 'PUT', 'PATCH'].includes(r.verb))
      .map((r) => r.route);
    expect(destructive).toEqual([]);
  });

  it('only exposes POST publicly for enumerated session-bootstrap routes', () => {
    const unexpected = rows
      .filter((r) => r.isPublic && r.verb === 'POST' && !PUBLIC_POST_ALLOWLIST.has(r.route))
      .map((r) => r.route);
    expect(unexpected).toEqual([]);
  });

  it('keeps the public surface a small minority of the API', () => {
    const publicCount = rows.filter((r) => r.isPublic).length;
    // ~10% today. A jump means someone widened the surface a lot at once.
    expect(publicCount / rows.length).toBeLessThan(0.2);
  });
});
