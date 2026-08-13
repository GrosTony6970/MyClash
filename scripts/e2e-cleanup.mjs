#!/usr/bin/env node
/**
 * e2e-cleanup.mjs — delete every throwaway event the prod E2E suite left behind.
 *
 * `tests/e2e/global-teardown.ts` only deletes **the event its own run created**,
 * and only when `E2E_CLEANUP=1`. Anything a run preserved — the default — is
 * invisible to every later run, so leftovers accumulate in the target org until
 * somebody removes them by hand. Spec 17 makes the problem sharper: it creates
 * its own disposable events (source + restored copy) that the run context never
 * hears about at all.
 *
 * This sweeps the org instead of a run, so it collects everything regardless of
 * which run made it or whether that run finished.
 *
 * TWO TRAPS THIS SCRIPT EXISTS TO AVOID
 *
 * 1. `GET /api/v1/events/:slug` is the PUBLIC resolver and 404s an event whose
 *    `event_kind` is `test` — by design (`isPubliclyVisible`). A cleanup script
 *    that pre-checks or verifies per id reads those 404s as "already gone",
 *    skips the delete, and then reports success for exactly the rows it missed.
 *    Everything here goes through `GET /organizations/:orgId/events`, which is
 *    the admin read and returns test rows.
 *
 * 2. Login is throttled (3/hour per email), so the stored session is reused
 *    whenever it is fresh — same rule as `global-setup.ts`. A cleanup run must
 *    not burn the login budget the next test run needs.
 *
 * Usage:
 *   pnpm e2e:cleanup             # delete, then verify nothing remains
 *   pnpm e2e:cleanup --dry-run   # list what would go, touch nothing
 */
import { request } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { rm, stat } from 'node:fs/promises';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';
const SESSION_MAX_AGE_MIN = 45;

/**
 * The slug prefix `global-setup` and the archive spec both build their events
 * from. Deliberately anchored: a real event merely *containing* "e2e" must
 * never match, because this deletes hard and does not ask.
 */
export const E2E_SLUG_PREFIX = /^e2e-/;

/** Which of an org's events this sweep owns. */
export function selectDisposable(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => typeof event?.slug === 'string' && E2E_SLUG_PREFIX.test(event.slug))
    .map((event) => ({
      id: event.id,
      slug: event.slug,
      kind: event.event_kind ?? event.eventKind ?? 'unknown',
    }));
}

/**
 * Delete one event the way `global-teardown` does, in the order that works.
 *
 * The club-kind flip comes first because a `standard` event holding recorded
 * results refuses both the tournament delete and the event hard delete
 * ("Submit a deletion request instead") — right for a real event, wrong for a
 * throwaway one. Pools go next: matches hold ON DELETE RESTRICT references to
 * registrations, so the cascade stalls on them otherwise.
 *
 * Every step is best-effort except the last, whose result is returned: a
 * tournament that refuses to pre-delete still disappears when the event
 * cascades through it.
 */
export async function deleteEvent(api, event) {
  await api.patch(`/api/v1/events/${event.id}`, { data: { eventKind: 'club' } });

  const tournaments = await api.get(`/api/v1/events/${event.id}/tournaments`);
  if (tournaments.ok()) {
    for (const tournament of await tournaments.json()) {
      await api.delete(`/api/v1/tournaments/${tournament.id}/pools`);
      await api.delete(`/api/v1/tournaments/${tournament.id}`);
    }
  }

  const res = await api.delete(`/api/v1/events/${event.id}?mode=hard`);
  return { ok: res.ok(), status: res.status(), body: res.ok() ? '' : await res.text() };
}

/**
 * Sweep an org. Returns a summary; NEVER trusts the delete responses — it
 * re-reads the org list and reports what is actually still there.
 */
export async function sweep({ api, orgId, dryRun = false, log = console.log }) {
  const listed = await api.get(`/api/v1/organizations/${orgId}/events`);
  if (!listed.ok()) {
    throw new Error(`could not list events for org ${orgId}: ${listed.status()}`);
  }
  const targets = selectDisposable(await listed.json());

  if (targets.length === 0) {
    log('[e2e-cleanup] nothing to clean up');
    return { found: 0, deleted: 0, failed: 0, remaining: 0 };
  }

  log(`[e2e-cleanup] ${targets.length} leftover event(s):`);
  for (const event of targets) log(`  ${event.kind.padEnd(8)} ${event.slug}  (${event.id})`);

  if (dryRun) {
    log('[e2e-cleanup] --dry-run: nothing deleted');
    return { found: targets.length, deleted: 0, failed: 0, remaining: targets.length };
  }

  let deleted = 0;
  let failed = 0;
  for (const event of targets) {
    const result = await deleteEvent(api, event);
    if (result.ok) {
      deleted += 1;
      log(`  deleted  ${event.slug}`);
    } else {
      failed += 1;
      log(`  FAILED   ${event.slug} — ${result.status} ${result.body.slice(0, 200)}`);
    }
  }

  // The verification that matters: re-read the list rather than believe the
  // status codes. See trap 1 in the header.
  const after = await api.get(`/api/v1/organizations/${orgId}/events`);
  const remaining = after.ok() ? selectDisposable(await after.json()) : targets;
  for (const event of remaining) log(`  STILL PRESENT  ${event.slug} (${event.id})`);

  log(`[e2e-cleanup] deleted ${deleted}, failed ${failed}, remaining ${remaining.length}`);
  return { found: targets.length, deleted, failed, remaining: remaining.length };
}

/**
 * Non-zero only when a REAL sweep could not finish the job.
 *
 * `--dry-run` always exits 0: it is a report, and finding leftovers is what it
 * is for. Coupling the two made `pnpm e2e:cleanup --dry-run` fail every time it
 * had something to say, which is the fastest way to teach everyone to ignore
 * the exit code.
 */
export function exitCodeFor(summary, dryRun) {
  if (dryRun) return 0;
  return summary.failed > 0 || summary.remaining > 0 ? 1 : 0;
}

async function sessionIsFresh() {
  try {
    const { mtimeMs } = await stat(AUTH_FILE);
    return (Date.now() - mtimeMs) / 60_000 < SESSION_MAX_AGE_MIN;
  } catch {
    return false;
  }
}

async function authenticatedContext(baseURL) {
  if (await sessionIsFresh()) {
    return request.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: AUTH_FILE });
  }

  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'no fresh session in tests/e2e/.auth/admin.json and no E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD to log in with',
    );
  }
  const ctx = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const res = await ctx.post('/api/v1/auth/password-login', { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
  return ctx;
}

async function main() {
  loadEnv({ path: '.env.e2e' });
  const dryRun = process.argv.includes('--dry-run');
  const baseURL = process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';
  const orgSlug = process.env.E2E_ORG_SLUG;
  if (!orgSlug) throw new Error('E2E_ORG_SLUG is required (see .env.e2e.example)');

  const ctx = await authenticatedContext(baseURL);
  const orgRes = await ctx.get(`/api/v1/organizations/slug/${orgSlug}`);
  if (!orgRes.ok()) {
    throw new Error(`could not resolve org '${orgSlug}': ${orgRes.status()}`);
  }
  const { id: orgId } = await orgRes.json();

  const summary = await sweep({ api: ctx, orgId, dryRun });
  await ctx.dispose();

  // The run context points at an event this sweep has just deleted; leaving it
  // makes the next teardown chase a 404.
  if (!dryRun && summary.deleted > 0) await rm(CONTEXT_FILE, { force: true });

  process.exitCode = exitCodeFor(summary, dryRun);
}

// Importable for the test; only sweeps when run directly.
if (process.argv[1] && process.argv[1].endsWith('e2e-cleanup.mjs')) {
  await main();
}
