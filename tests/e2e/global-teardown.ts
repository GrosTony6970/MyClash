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
 *
 * It also reclassifies the event as a CLUB event first — see the comment on
 * that step. Without it, an event that holds scored matches cannot be deleted
 * at all, which is the state every run reaches now that six specs play real
 * tournaments.
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

  // 1) Reclassify the event as a CLUB event so it becomes disposable.
  //
  // The suite scores real matches (09-15), and a `standard` event holding
  // recorded results refuses both the tournament delete and the event hard
  // delete — "Submit a deletion request instead". That is the right rule for a
  // real event and exactly wrong for a throwaway one, so every run used to
  // leave its event behind for good.
  //
  // `allowsDirectHardDelete` is true for club and test kinds alike, but the
  // event must stay STANDARD for the whole run: club events do not count toward
  // league standings (`countsTowardStats`) and cannot be submitted to HEMA
  // Ratings (`allowsRatingsExport`), which 11 and 12 both depend on. So the flip
  // happens here, after the last assertion and immediately before the delete.
  const kindRes = await ctx.patch(`/api/v1/events/${runCtx.eventId}`, {
    data: { eventKind: 'club' },
  });
  if (!kindRes.ok()) {
    console.warn(
      `[e2e] could not reclassify event ${runCtx.eventId} as a club event: ${kindRes.status()}` +
        ' — the delete below will fail if it holds recorded results',
    );
  }

  // 2) Delete tournaments first (clear pools → matches that block the cascade).
  const tRes = await ctx.get(`/api/v1/events/${runCtx.eventId}/tournaments`);
  if (tRes.ok()) {
    const tournaments = (await tRes.json()) as Array<{ id: string }>;
    for (const t of tournaments) {
      await ctx.delete(`/api/v1/tournaments/${t.id}/pools`); // best-effort: drop generated matches
      const dr = await ctx.delete(`/api/v1/tournaments/${t.id}`);
      if (!dr.ok()) {
        // Expected for a tournament with scored matches: that guard is
        // tournament-level and does not care about the event's kind. Harmless —
        // the event hard-delete below cascades through it. Logged quietly so a
        // real problem still shows up in the line that follows.
        console.log(
          `[e2e] tournament ${t.id} not pre-deleted (${dr.status()}); event will cascade`,
        );
      }
    }
  }

  // 3) Hard-delete the event (cascades persons, lices, programme blocks, …).
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
