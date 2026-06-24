import { request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Runs once before the prod E2E suite. It:
 *   1. logs in with the dedicated test account (cookie-based GoTrue session),
 *   2. resolves the target organization id from its slug,
 *   3. creates a uniquely-named throwaway event to scope all test writes,
 * then persists the session (storageState) + run context for the specs.
 *
 * The event is hard-deleted in global-teardown, which cascades to its
 * tournaments, persons, registrations, lices and matches — so prod is never
 * left polluted, even if specs fail.
 */

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';
  const email = required('E2E_ADMIN_EMAIL');
  const password = required('E2E_ADMIN_PASSWORD');
  const orgSlug = required('E2E_ORG_SLUG');

  const ctx = await request.newContext({ baseURL, ignoreHTTPSErrors: true });

  // 1) Log in once. password-login is throttled (3/hr per email), so this is
  //    the only login per run — every spec reuses the storageState below.
  const login = await ctx.post('/api/v1/auth/password-login', {
    data: { email, password },
  });
  if (!login.ok()) {
    throw new Error(`[e2e] login failed: ${login.status()} ${await login.text()}`);
  }

  // 2) Resolve org id from slug.
  const orgRes = await ctx.get(`/api/v1/organizations/slug/${orgSlug}`);
  if (!orgRes.ok()) {
    throw new Error(
      `[e2e] resolve org '${orgSlug}' failed: ${orgRes.status()} ${await orgRes.text()}`,
    );
  }
  const org = (await orgRes.json()) as { id?: string };
  const orgId = org.id;
  if (!orgId) throw new Error(`[e2e] org '${orgSlug}' response had no id`);

  // 3) Create a throwaway event. A timestamped slug guarantees uniqueness even
  //    if a previous teardown failed to clean up.
  const runId = `${process.env.E2E_RUN_ID ?? 'local'}-${Date.now().toString(36)}`;
  const eventSlug = `e2e-${runId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 80);
  const eventRes = await ctx.post(`/api/v1/organizations/${orgId}/events`, {
    data: {
      name: `E2E TEST (auto) — ${runId}`,
      slug: eventSlug,
      startDate: '2099-01-01',
      endDate: '2099-01-02',
      city: 'Testville',
      country: 'FR',
    },
  });
  if (!eventRes.ok()) {
    throw new Error(
      `[e2e] create test event failed: ${eventRes.status()} ${await eventRes.text()}`,
    );
  }
  const event = (await eventRes.json()) as { id?: string };
  const eventId = event.id;
  if (!eventId) throw new Error('[e2e] create event response had no id');

  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await writeFile(
    CONTEXT_FILE,
    JSON.stringify({ orgId, orgSlug, eventId, eventSlug, baseURL }, null, 2),
  );
  await ctx.dispose();

  console.log(`[e2e] ready: event ${eventSlug} (${eventId}) in org ${orgSlug}`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[e2e] missing required env var ${name} (set it in .env.e2e or CI secrets)`);
  }
  return value;
}
