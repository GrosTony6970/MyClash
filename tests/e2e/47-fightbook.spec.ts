import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import {
  FIGHTERS_MISSING,
  FIGHTER_LOGINS,
  publicBase,
  signInFighter,
  type Fighter,
} from './_fighters';

/**
 * FightBook between two real accounts (run with `E2E_FIGHTBOOK=1` and the two
 * fighter accounts of `_fighters.ts`).
 *
 * FightBook (2026-11-11 to 11-13) lets a fighter ask another for a spar at an
 * Event, and both keep a record afterwards. Its rules live in the database
 * (`fightbook_ask`) and in a dozen routes; nothing above the unit tests and the
 * CI database probes had ever driven them. This spec does, A asking B, on a
 * published club Event of its own dated TODAY — an Event spar must fall on one
 * of the Event's days, and "we sparred" opens on the spar's day:
 *
 *   1. both switch FightBook on; A's page shows the FightBook tabs, switched on;
 *   2. A cannot ask themselves; A asks B; asking again is refused;
 *   3. B sees the request in their Inbox, on screen, and taps Yes;
 *   4. A hearts B and takes it back;
 *   5. A marks "we sparred", takes it back, then cancels the spar — so no
 *      public "sparred N times" is left behind;
 *   6. A flags a safety problem on the spar; the organisation's admins see it
 *      on their list and mark it handled;
 *   7. B blocks A: A's next ask is stored as "not this time", with no error —
 *      a block is silent by design; B unblocks;
 *   8. B sets a daily limit, which reads back.
 *
 * Both accounts' FightBook settings are read first and put back at the end.
 *
 * Not covered: "free to spar now", open calls and the QR log (the floor tools,
 * which need the Event open on the real clock at the venue), the 10-minute
 * reminder and the end-of-day expiry (both run in the worker).
 *
 * Notices: the ask, the yes and "we sparred" send real notices to the two
 * fighter accounts, and the safety flag ALERTS EVERY ADMIN OF THE E2E
 * ORGANISATION (push, or email). It runs only on an organisation whose admins
 * expect it.
 */
const FIGHTBOOK = ['1', 'true', 'yes'].includes((process.env.E2E_FIGHTBOOK ?? '').toLowerCase());
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

/** The Event's clock. An Event spar's day is a day of the Event, on its own clock. */
const ZONE = 'Europe/Paris';

interface Settings {
  hasProfile: boolean;
  enabled: boolean;
  showStars: boolean;
  dailyLimit: number | null;
}

interface MySpars {
  spars: Array<{ id: string; status: string; iFlagged: boolean }>;
  sent: Array<{ id: string; status: string }>;
}

const createdEventIds: string[] = [];

test.describe('fightbook', () => {
  test.skip(!FIGHTBOOK, 'set E2E_FIGHTBOOK=1 to drive FightBook between two fighter accounts');
  test.skip(FIGHTERS_MISSING !== null, FIGHTERS_MISSING ?? '');

  test.afterAll(async ({ playwright }) => {
    const { baseURL, orgSlug } = runContext();
    const ctx = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    const api = apiFor(ctx);
    for (const id of createdEventIds) {
      if (CLEANUP) {
        const res = await api.delete(`events/${id}?mode=hard`);
        if (!res.ok())
          console.warn(`[e2e] could not delete fightbook event ${id}: ${res.status()}`);
        continue;
      }
      const hidden = await api.patch(`events/${id}`, { data: { eventKind: 'test' } });
      if (!hidden.ok())
        console.warn(`[e2e] could not hide fightbook event ${id}: ${hidden.status()}`);
      console.log(`[e2e] fightbook event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
    }
    await ctx.dispose();
  });

  test('A asks B at an Event, B says yes, and the spar runs its course', async ({
    request,
    browser,
  }) => {
    test.setTimeout(300_000);
    const organizer = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());

    const a = await signInFighter(browser, FIGHTER_LOGINS[0]!);
    const b = await signInFighter(browser, FIGHTER_LOGINS[1]!);
    const before = new Map<Fighter, Settings>();

    try {
      for (const f of [a, b]) {
        const s = await f.api.json<Settings>(await f.api.get('me/fightbook/settings'));
        expect(s.hasProfile, `fighter ${f.label} must hold a fighter profile`).toBe(true);
        before.set(f, s);
      }

      // ── A public club Event, today, with A on its roster ─────────────────
      // Only the ASKER of an Event spar must be at the Event. A joins by
      // themselves, which is the path a fighter at a real Event takes.
      const event = await organizer.json<{ id: string }>(
        await organizer.post(`organizations/${orgId}/events`, {
          data: {
            name: `E2E TEST (auto) fightbook — ${token}`,
            slug: `e2e-fightbook-${token}`,
            startDate: today,
            endDate: today,
            timezone: ZONE,
            city: 'Testville',
            country: 'FR',
            eventKind: 'club',
          },
        }),
      );
      createdEventIds.push(event.id);
      await organizer.ok(await organizer.post(`events/${event.id}/publish`, { data: {} }));
      await organizer.ok(
        await organizer.patch(`events/${event.id}`, { data: { workshopSelfJoin: true } }),
      );
      await a.api.ok(await a.api.post(`me/events/${event.id}/join`, { data: {} }));

      // ── 1. Both on, and A's page says so ──────────────────────────────────
      await a.api.ok(await a.api.patch('me/fightbook/settings', { data: { enabled: true } }));
      await b.api.ok(
        await b.api.patch('me/fightbook/settings', { data: { enabled: true, dailyLimit: null } }),
      );
      const aPage = await a.context.newPage();
      await aPage.goto(`${publicBase}/me/fightbook`, { waitUntil: 'domcontentloaded' });
      await expect(aPage.getByRole('tablist', { name: 'FightBook' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(aPage.getByRole('switch', { name: 'Use FightBook' })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      // ── 2. The ask ────────────────────────────────────────────────────────
      const message = `E2E spar ${token}`;
      const ask = (receiverGlobalPersonId: string) =>
        a.api.post('me/fightbook/requests', {
          data: {
            receiverGlobalPersonId,
            kind: 'event',
            eventId: event.id,
            day: today,
            // No time: a timed spar also queues the 10-minute reminder.
            weapons: ['Longsword'],
            message,
          },
        });

      const self = await ask(a.globalPersonId);
      expect(self.status(), 'a fighter cannot ask themselves').toBe(400);
      expect(await self.text()).toContain('self');

      const { id: sparId } = await a.api.json<{ id: string }>(await ask(b.globalPersonId));
      const twice = await ask(b.globalPersonId);
      expect(twice.status(), 'a second ask while one is pending').toBe(409);
      expect(await twice.text()).toContain('already_asked');

      // ── 3. B answers Yes, on screen ───────────────────────────────────────
      const bPage = await b.context.newPage();
      await bPage.goto(`${publicBase}/me/fightbook`, { waitUntil: 'domcontentloaded' });
      const card = bPage.locator('li[data-spar-card]').filter({ hasText: message });
      await expect(card, "the request must reach B's Inbox").toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: 'Yes', exact: true }).click();
      await expect.poll(() => statusOf(a.api, sparId), { timeout: 20_000 }).toBe('agreed');
      expect(await statusOf(b.api, sparId), 'both sides read the same spar').toBe('agreed');

      // ── 4. A heart, given and taken back ──────────────────────────────────
      await a.api.ok(await a.api.put(`me/fightbook/favourites/${b.globalPersonId}`, { data: {} }));
      expect(await askable(a.api, b.globalPersonId)).toEqual({ askable: true, favourite: true });
      await a.api.ok(await a.api.delete(`me/fightbook/favourites/${b.globalPersonId}`));
      expect((await askable(a.api, b.globalPersonId)).favourite).toBe(false);

      // ── 5. We sparred, undone, then the spar cancelled ────────────────────
      await a.api.ok(await a.api.post(`me/fightbook/requests/${sparId}/done`));
      expect(await statusOf(b.api, sparId), '"we sparred" reaches the partner').toBe('done');
      await a.api.ok(await a.api.post(`me/fightbook/requests/${sparId}/undo`));
      expect(await statusOf(a.api, sparId)).toBe('agreed');
      await a.api.ok(
        await a.api.post(`me/fightbook/requests/${sparId}/cancel`, { data: { message: 'E2E' } }),
      );
      expect(await statusOf(b.api, sparId)).toBe('cancelled');

      // ── 6. A safety flag, read and handled by the organisation ────────────
      const flagText = `E2E safety report ${token}`;
      await a.api.ok(
        await a.api.post(`me/fightbook/requests/${sparId}/flag`, {
          data: { reason: 'other', text: flagText },
        }),
      );
      expect((await mySpars(a.api)).spars.find((s) => s.id === sparId)?.iFlagged).toBe(true);
      const flagOf = async () =>
        (
          await organizer.json<{ items: Array<{ id: string; text: string; handled: boolean }> }>(
            await organizer.get(`organizations/${orgId}/fightbook/flags`),
          )
        ).items.find((f) => f.text === flagText);
      await expect
        .poll(async () => (await flagOf())?.handled, {
          timeout: 20_000,
          message: "the flag must reach the Event's organisation, unhandled",
        })
        .toBe(false);
      await organizer.ok(
        await organizer.put(
          `organizations/${orgId}/fightbook/flags/${(await flagOf())!.id}/handled`,
          {
            data: {},
          },
        ),
      );
      expect((await flagOf())?.handled).toBe(true);

      // ── 7. A block is silent ──────────────────────────────────────────────
      await b.api.ok(
        await b.api.post('me/fightbook/blocks', { data: { globalPersonId: a.globalPersonId } }),
      );
      const blocked = await b.api.json<Array<{ fighter: { globalPersonId: string } }>>(
        await b.api.get('me/fightbook/blocks'),
      );
      expect(blocked.map((x) => x.fighter.globalPersonId)).toContain(a.globalPersonId);
      const { id: quietId } = await a.api.json<{ id: string }>(await ask(b.globalPersonId));
      expect(
        (await mySpars(a.api)).sent.find((s) => s.id === quietId)?.status,
        'a blocked asker is told "not this time", never "blocked"',
      ).toBe('not_this_time');
      await b.api.ok(await b.api.delete(`me/fightbook/blocks/${a.globalPersonId}`));

      // ── 8. A daily limit reads back ───────────────────────────────────────
      await b.api.ok(await b.api.patch('me/fightbook/settings', { data: { dailyLimit: 1 } }));
      expect(
        (await b.api.json<Settings>(await b.api.get('me/fightbook/settings'))).dailyLimit,
      ).toBe(1);
    } finally {
      // Put both accounts' FightBook back as it was.
      for (const [f, s] of before) {
        await f.api.patch('me/fightbook/settings', {
          data: { enabled: s.enabled, showStars: s.showStars, dailyLimit: s.dailyLimit },
        });
      }
      await a.context.close();
      await b.context.close();
    }
  });
});

const mySpars = async (api: Api): Promise<MySpars> =>
  api.json<MySpars>(await api.get('me/fightbook/spars'));

const statusOf = async (api: Api, sparId: string): Promise<string | undefined> =>
  (await mySpars(api)).spars.find((s) => s.id === sparId)?.status;

const askable = async (
  api: Api,
  globalPersonId: string,
): Promise<{ askable: boolean; favourite: boolean }> =>
  api.json(await api.get(`me/fightbook/fighters/${globalPersonId}/askable`));
