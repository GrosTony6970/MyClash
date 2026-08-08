/**
 * frontend-route-contract.test.ts — every /api/v1/… the frontends call must exist.
 *
 * WHY THIS EXISTS: several features shipped with a frontend and NO backend, and
 * nobody noticed for ~14 months. T-604 (highlights), T-605 (pool standings),
 * T-611 (people profile), T-1003 (stats page) and T-909/910 (referee dashboard)
 * each added a page and touched ZERO api files — `git show --stat <sha> -- apps/api`
 * is empty for all of them.
 *
 * They stayed invisible because every caller is `if (res.ok)` / `if (!res.ok)
 * return []`, which treats "this route does not exist" — a deploy-time bug —
 * exactly like "no data yet". A permanent outage renders as a plausible empty
 * section: the public stats page has been entirely blank, the per-pool standings
 * table has shown a header with zero rows, and "Live Now" has never rendered once.
 *
 * So: reflect the REAL routes (the metadata Nest serves) and assert every literal
 * the frontends call resolves to one. This lives in apps/api because that is where
 * the route truth is; the frontends are read as text, not imported.
 *
 * NOT tested against packages/api-client/src/generated/schema.ts — that OpenAPI
 * emit is incomplete (461 paths vs 572 real routes), so it would flag ~111 working
 * routes as phantom.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { beforeAll, describe, expect, it } from 'vitest';

const API_SRC = join(__dirname, '..', '..');
const REPO_ROOT = join(API_SRC, '..', '..', '..');
const FRONTENDS = ['apps/web-public', 'apps/web-admin', 'apps/web-staff'];

/**
 * Phantom paths that are known-broken and tracked, so the suite can go green
 * while they are fixed one feature at a time.
 *
 * This list may only ever SHRINK. Adding to it means shipping a call to a route
 * that does not exist — which is the entire bug this file exists to prevent.
 */
const KNOWN_PHANTOM: string[] = [
  // Personal event-home surfaces — never built.
  '/api/v1/events/{p}/my-matches',
  '/api/v1/events/{p}/following/matches',
  // web-admin candidates — not yet investigated.
  '/api/v1/admin/fighters/{p}',
  '/api/v1/tournaments',
  // Prose in a comment, not a call.
  '/api/v1/events.',
];

type Call = { path: string; sites: string[] };

function walk(dir: string, skip: string[] = []): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (skip.includes(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path, skip) : [path];
  });
}

/**
 * The routes Nest actually serves, reflected from the controller metadata.
 *
 * Reflection rather than text-parsing on purpose: several files declare more
 * than one @Controller (fighters.controller.ts has three — fighters, weapons,
 * global-persons; generated-content.controller.ts has two). Grabbing "the
 * @Controller prefix" per FILE silently gives every route in the 2nd and 3rd
 * class the wrong prefix, which reports real routes as phantom. Ask the
 * metadata, the same way AuthGuard's Reflector does at runtime.
 */
async function realRoutes(): Promise<string[][]> {
  const files = walk(join(API_SRC, 'modules')).filter((f) => f.endsWith('.controller.ts'));
  const routes: string[][] = [];

  for (const file of files) {
    // Plain absolute path — not pathToFileURL: this checkout path can contain a
    // space, which the file:// URL percent-encodes and vitest cannot resolve.
    const mod = (await import(file.split(sep).join('/'))) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || !(exported as { prototype?: object }).prototype) {
        continue;
      }
      const prefix = Reflect.getMetadata(PATH_METADATA, exported) as string | undefined;
      if (prefix === undefined) continue; // not a @Controller

      const proto = (exported as { prototype: object }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = (proto as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue; // not a route

        const full = `/api/v1/${[prefix, path].filter((p) => p && p !== '/').join('/')}`;
        routes.push(full.replace(/\/+/g, '/').split('/').filter(Boolean));
      }
    }
  }
  return routes;
}

/** Every /api/v1/… literal in the frontends, with `${expr}` normalised to {p}. */
function frontendCalls(): Call[] {
  const found = new Map<string, Set<string>>();

  for (const app of FRONTENDS) {
    const dir = join(REPO_ROOT, app);
    if (!existsSync(dir)) continue;
    const files = walk(dir, ['node_modules', '.next', 'dist']).filter((f) => /\.tsx?$/.test(f));

    for (const file of files) {
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          for (const m of line.matchAll(
            /\/api\/v1\/(?:\$\{[^}]*\}|[A-Za-z0-9._:-])+(?:\/(?:\$\{[^}]*\}|[A-Za-z0-9._:-])+)*/g,
          )) {
            const path = m[0].replace(/\$\{[^}]*\}/g, '{p}');
            if (!found.has(path)) found.set(path, new Set());
            found
              .get(path)
              ?.add(`${relative(REPO_ROOT, file).split(sep).join('/')}:${String(i + 1)}`);
          }
        });
    }
  }
  return [...found].map(([path, sites]) => ({ path, sites: [...sites] }));
}

/**
 * KNOWN LIMITATION, deliberately chosen: an interpolated `{p}` is allowed to
 * match a LITERAL route segment.
 *
 * It has to be. Callers interpolate constants into literal positions all the
 * time — `me/insight/${publish ? 'publish' : 'unpublish'}` and
 * `clubs/${id}/${action}` are real examples here — so forbidding it
 * false-positives on ~11 working routes and the test becomes noise nobody trusts.
 *
 * The cost: a phantom can hide when it is the same SHAPE as a real route, e.g.
 * `events/{p}/persons/{p}` silently "matches" `events/:eventId/persons/lookup`.
 * That is why the people-profile phantom is not in KNOWN_PHANTOM — this test
 * cannot see it.
 *
 * What it does catch is the class that actually bit us: a path that exists
 * nowhere in the API at all. All five frontend-only features were that.
 */
function matches(segs: string[], route: string[]): boolean {
  return (
    segs.length === route.length &&
    segs.every((s, i) => (route[i] ?? '').startsWith(':') || s === '{p}' || s === route[i])
  );
}

function served(segs: string[], routes: string[][]): boolean {
  if (routes.some((r) => matches(segs, r))) return true;

  // A trailing {p} glued to a segment is `?${qs}` (a query string), not a path
  // segment — e.g. `audit-log?${qs}` normalises to `audit-log{p}`. Retry without it.
  const last = segs[segs.length - 1] ?? '';
  if (last.endsWith('{p}') && last !== '{p}') {
    const trimmed = [...segs.slice(0, -1), last.replace(/\{p\}$/, '')].filter(Boolean);
    return routes.some((r) => matches(trimmed, r));
  }
  return false;
}

describe('frontend → API route contract', () => {
  let routes: string[][] = [];
  let calls: Call[] = [];

  beforeAll(async () => {
    routes = await realRoutes();
    calls = frontendCalls();
  }, 60_000);

  it('parses the API routes and the frontend calls at all', () => {
    // Without this, a parsing regression makes every assertion below pass
    // vacuously on empty sets — the exact failure mode that let the phantoms ship.
    expect(routes.length).toBeGreaterThan(500);
    expect(calls.length).toBeGreaterThan(200);
    expect(routes.some((r) => r.join('/') === 'api/v1/health')).toBe(true);
  });

  it('never calls an API route that does not exist', () => {
    const phantom = calls
      .filter((c) => c.path.split('/').filter(Boolean).length > 2)
      .filter((c) => !served(c.path.split('/').filter(Boolean), routes))
      .filter((c) => !KNOWN_PHANTOM.includes(c.path))
      .map((c) => `${c.path}\n      called from: ${c.sites.slice(0, 2).join(', ')}`);

    expect(phantom).toEqual([]);
  });

  it('keeps the known-phantom list honest — entries must still be phantom', () => {
    // Stops the list rotting into a lie of its own: once a route is built, its
    // entry must be removed, or the list slowly stops meaning anything.
    const called = new Set(calls.map((c) => c.path));
    const fixed = KNOWN_PHANTOM.filter(
      (p) => called.has(p) && served(p.split('/').filter(Boolean), routes),
    );
    expect(fixed).toEqual([]);
  });

  it('drops entries whose call site is gone', () => {
    const called = new Set(calls.map((c) => c.path));
    const stale = KNOWN_PHANTOM.filter((p) => !called.has(p));
    expect(stale).toEqual([]);
  });
});
