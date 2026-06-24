import { request } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';

const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

/**
 * By default the test event is PRESERVED so you can open it in the admin UI and
 * see what the run created (imported participants, the tournament, the generated
 * schedule). Set E2E_CLEANUP=1 (CI does) to hard-delete it instead.
 *
 * Cleanup order matters: pool matches reference registrations with ON DELETE
 * RESTRICT, so we clear each tournament's pools (→ matches) and delete the
 * tournament before hard-deleting the event. (The API now does this ordered
 * teardown server-side too, but doing it here keeps cleanup working against
 * older deploys.)
 */
export default async function globalTeardown() {
  let runCtx: { eventId: string; eventSlug: string; orgSlug?: string; baseURL?: string };
  try {
    runCtx = JSON.parse(await readFile(CONTEXT_FILE, 'utf8'));
  } catch {
    console.warn('[e2e] no run context found; nothing to tear down');
    return;
  }

  const baseURL = runCtx.baseURL ?? process.env.E2E_BASE_URL ?? 'https://admin.myclash.fr';
  const eventUrl = `${baseURL}/org/${runCtx.orgSlug ?? ''}/events/${runCtx.eventId}`;

  if (!CLEANUP) {
    console.log(
      `[e2e] data PRESERVED — open the test event in the admin UI:\n        ${eventUrl}\n` +
        `        (run with E2E_CLEANUP=1 to delete it instead)`,
    );
    return;
  }

  const ctx = await request.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: AUTH_FILE,
  });

  // 1) Delete tournaments first (clear pools → matches that block the cascade).
  const tRes = await ctx.get(`/api/v1/events/${runCtx.eventId}/tournaments`);
  if (tRes.ok()) {
    const tournaments = (await tRes.json()) as Array<{ id: string }>;
    for (const t of tournaments) {
      await ctx.delete(`/api/v1/tournaments/${t.id}/pools`); // best-effort: drop generated matches
      const dr = await ctx.delete(`/api/v1/tournaments/${t.id}`);
      if (!dr.ok()) {
        console.warn(
          `[e2e] could not delete tournament ${t.id}: ${dr.status()} ${await dr.text()}`,
        );
      }
    }
  }

  // 2) Hard-delete the event (cascades persons, lices, programme blocks, …).
  const res = await ctx.delete(`/api/v1/events/${runCtx.eventId}?mode=hard`);
  if (res.ok()) {
    console.log(`[e2e] cleaned up test event ${runCtx.eventSlug} (${runCtx.eventId})`);
  } else {
    console.error(
      `[e2e] ⚠ FAILED to delete test event ${runCtx.eventId}: ${res.status()} ${await res.text()}`,
    );
    console.error('[e2e] ⚠ Delete it manually to avoid leaving data behind.');
  }

  await ctx.dispose();
  await rm(CONTEXT_FILE, { force: true });
}
