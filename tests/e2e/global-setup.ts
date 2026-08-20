import { request, type APIRequestContext } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Runs once before the prod E2E suite. It:
 *   1. obtains an authenticated session (reusing a recent one when possible),
 *   2. resolves the target organization id from its slug,
 *   3. creates a uniquely-named throwaway event to scope all test writes,
 * then persists the session (storageState) + run context for the specs.
 *
 * The event is hard-deleted in global-teardown, which cascades to its
 * tournaments, persons, registrations, lices and matches — so the target env is
 * never left polluted, even if specs fail.
 *
 * password-login is throttled (10/hour per email), so we REUSE a stored session
 * when it is fresh enough (cookies live ~1h) and only log in when needed. This
 * keeps rapid local iteration from hitting the rate limit.
 */

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';
const SESSION_MAX_AGE_MIN = 45;

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';
  const email = required('E2E_ADMIN_EMAIL');
  const password = required('E2E_ADMIN_PASSWORD');
  const orgSlug = required('E2E_ORG_SLUG');

  let ctx = await reuseSession(baseURL);
  let didLogin = false;
  if (!ctx) {
    ctx = await login(baseURL, email, password);
    didLogin = true;
  }

  // Resolve org id from slug.
  const orgRes = await ctx.get(`/api/v1/organizations/slug/${orgSlug}`);
  if (!orgRes.ok()) {
    throw new Error(
      `[e2e] resolve org '${orgSlug}' failed: ${orgRes.status()} ${await orgRes.text()}`,
    );
  }
  const orgId = ((await orgRes.json()) as { id?: string }).id;
  if (!orgId) throw new Error(`[e2e] org '${orgSlug}' response had no id`);

  // Create a throwaway event. A timestamped slug guarantees uniqueness even if
  // a previous teardown failed to clean up.
  const runId = `${process.env.E2E_RUN_ID ?? 'local'}-${Date.now().toString(36)}`;
  const eventSlug = `e2e-${runId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 80);
  const payload = {
    name: `E2E TEST (auto) — ${runId}`,
    slug: eventSlug,
    startDate: '2099-01-01',
    endDate: '2099-01-02',
    city: 'Testville',
    country: 'FR',
  };
  let eventRes = await ctx.post(`/api/v1/organizations/${orgId}/events`, { data: payload });
  if ((eventRes.status() === 401 || eventRes.status() === 403) && !didLogin) {
    // The reused session was stale — log in fresh and retry once.
    await ctx.dispose();
    ctx = await login(baseURL, email, password);
    didLogin = true;
    eventRes = await ctx.post(`/api/v1/organizations/${orgId}/events`, { data: payload });
  }
  if (!eventRes.ok()) {
    throw new Error(
      `[e2e] create test event failed: ${eventRes.status()} ${await eventRes.text()}`,
    );
  }
  const eventId = ((await eventRes.json()) as { id?: string }).id;
  if (!eventId) throw new Error('[e2e] create event response had no id');

  await mkdir(dirname(AUTH_FILE), { recursive: true });
  // Only (re)write the session file on a fresh login, so its mtime tracks login
  // age for the reuse window above.
  if (didLogin) await ctx.storageState({ path: AUTH_FILE });
  await writeFile(
    CONTEXT_FILE,
    JSON.stringify({ orgId, orgSlug, eventId, eventSlug, baseURL }, null, 2),
  );
  await ctx.dispose();

  console.log(
    `[e2e] ready (${didLogin ? 'fresh login' : 'reused session'}): event ${eventSlug} (${eventId}) in org ${orgSlug}`,
  );
}

async function reuseSession(baseURL: string): Promise<APIRequestContext | null> {
  try {
    const ageMin = (Date.now() - (await stat(AUTH_FILE)).mtimeMs) / 60_000;
    if (ageMin >= SESSION_MAX_AGE_MIN) return null;
    return await request.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: AUTH_FILE });
  } catch {
    return null;
  }
}

async function login(baseURL: string, email: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const res = await ctx.post('/api/v1/auth/password-login', { data: { email, password } });
  if (!res.ok()) throw new Error(`[e2e] login failed: ${res.status()} ${await res.text()}`);
  return ctx;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[e2e] missing required env var ${name} (set it in .env.e2e or CI secrets)`);
  }
  return value;
}
