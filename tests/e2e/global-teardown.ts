import { request } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';

/**
 * Hard-deletes the throwaway event created in global-setup. Reuses the session
 * captured there (no extra login → stays under the password-login rate limit).
 * The delete cascades to tournaments, persons, registrations, lices and
 * matches, so a single call cleans up everything the suite created.
 */
export default async function globalTeardown() {
  let runCtx: { eventId: string; eventSlug: string; baseURL?: string };
  try {
    runCtx = JSON.parse(await readFile(CONTEXT_FILE, 'utf8'));
  } catch {
    console.warn('[e2e] no run context found; nothing to tear down');
    return;
  }

  const ctx = await request.newContext({
    baseURL: runCtx.baseURL ?? process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr',
    ignoreHTTPSErrors: true,
    storageState: AUTH_FILE,
  });

  const res = await ctx.delete(`/api/v1/events/${runCtx.eventId}?mode=hard`);
  if (res.ok()) {
    console.log(`[e2e] cleaned up test event ${runCtx.eventSlug} (${runCtx.eventId})`);
  } else {
    console.error(
      `[e2e] ⚠ FAILED to delete test event ${runCtx.eventId}: ${res.status()} ${await res.text()}`,
    );
    console.error('[e2e] ⚠ Delete it manually to avoid leaving data on prod.');
  }

  await ctx.dispose();
  await rm(CONTEXT_FILE, { force: true });
}
