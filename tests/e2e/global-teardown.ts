import { request } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const CONTEXT_FILE = 'tests/e2e/.auth/context.json';

/**
 * Cleans up the throwaway event created in global-setup. Reuses the session
 * captured there (no extra login → stays under the password-login rate limit).
 *
 * Order matters: registrations reference persons with ON DELETE RESTRICT, so an
 * event hard-delete fails while any tournament (and thus its registrations)
 * still exists. We therefore delete the event's tournaments first — which
 * cascades their registrations, phases, pools and matches — then hard-delete
 * the event (cascading the remaining persons, lices, etc).
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

  // 1) Delete tournaments first (clears registrations/matches that would
  //    otherwise block the persons cascade). Pool matches reference
  //    registrations with ON DELETE RESTRICT, so clear pools (→ matches) before
  //    deleting each tournament, else the tournament delete itself fails.
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
