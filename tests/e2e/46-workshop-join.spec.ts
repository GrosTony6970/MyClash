import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureRoster } from './_bracket';
import { FIGHTERS_MISSING, FIGHTER_LOGINS, publicBase, signInFighter } from './_fighters';

/**
 * Joining an Event by oneself, from a Workshop page (run with
 * `E2E_WORKSHOP_JOIN=1` and the two fighter accounts of `_fighters.ts`).
 *
 * An organiser can let people join an Event by themselves; someone not on the
 * roster who taps "Register" on a Workshop session is then offered to join and
 * book in one go. `19` covers seats and the waitlist through the API, as the
 * organiser; nothing drove the fighter's side, nor the public Workshop pages.
 * This spec, on its own published club Event:
 *
 *   1. the join is refused (409 `SELF_JOIN_CLOSED`) while the switch is off;
 *   2. the organiser turns the switch on, in the admin app;
 *   3. the public Workshops list filters by weapon and by instructor;
 *   4. the Workshop page shows its instructor and weapon, and fighter B, not on
 *      the roster, taps Register, joins and books — B lands on the roster with
 *      their own profile, with a confirmed seat;
 *   5. a second join answers `already`, and adds nobody.
 *
 * Fighter B is used, not A, so the two fighter specs never fight over one roster
 * row. The instructor is a throwaway roster person: adding an instructor marks
 * the profile an instructor for good, which must never happen to a real account.
 */
const WORKSHOP_JOIN = ['1', 'true', 'yes'].includes(
  (process.env.E2E_WORKSHOP_JOIN ?? '').toLowerCase(),
);
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

interface RosterRow {
  personId: string;
  status: string;
}

const createdEventIds: string[] = [];

test.describe('workshop join', () => {
  test.skip(!WORKSHOP_JOIN, 'set E2E_WORKSHOP_JOIN=1 to join an Event from a Workshop page');
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
        if (!res.ok()) console.warn(`[e2e] could not delete join event ${id}: ${res.status()}`);
        continue;
      }
      const hidden = await api.patch(`events/${id}`, { data: { eventKind: 'test' } });
      if (!hidden.ok()) console.warn(`[e2e] could not hide join event ${id}: ${hidden.status()}`);
      console.log(`[e2e] workshop-join event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
    }
    await ctx.dispose();
  });

  test('a fighter not on the roster joins and books from the Workshop page', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);
    const api = apiFor(request);
    const { orgId, orgSlug, baseURL } = runContext();
    const token = Date.now().toString(36);
    const fighter = await signInFighter(browser, FIGHTER_LOGINS[1]!);

    try {
      // ── A public club Event with two Workshops ───────────────────────────
      const eventSlug = `e2e-join-${token}`;
      const event = await api.json<{ id: string }>(
        await api.post(`organizations/${orgId}/events`, {
          data: {
            name: `E2E TEST (auto) workshop join — ${token}`,
            slug: eventSlug,
            startDate: '2099-07-01',
            endDate: '2099-07-02',
            city: 'Testville',
            country: 'FR',
            eventKind: 'club',
          },
        }),
      );
      createdEventIds.push(event.id);
      await api.ok(await api.post(`events/${event.id}/publish`, { data: {} }));

      const [teacher] = await ensureRoster(api, event.id, [
        { givenName: 'Wsjoin', familyName: `Teacher${token}` },
      ]);
      const persons = await api.json<Array<{ id: string; globalPersonId: string | null }>>(
        await api.get(`events/${event.id}/persons`),
      );
      const teacherGlobalId = persons.find((p) => p.id === teacher!.id)?.globalPersonId;
      expect(teacherGlobalId, 'the instructor needs a global profile').toBeTruthy();

      const longsword = await createWorkshop(api, event.id, `join-ls-${token}`, 'Longsword');
      const sabre = await createWorkshop(api, event.id, `join-sb-${token}`, 'Sabre');
      await api.ok(
        await api.post(`workshops/${longsword.id}/instructors`, {
          data: { globalPersonId: teacherGlobalId },
        }),
      );

      // ── 1. Closed while the switch is off ────────────────────────────────
      const closed = await fighter.api.post(`me/events/${event.id}/join`, { data: {} });
      expect(closed.status(), 'joining must be refused while the switch is off').toBe(409);
      expect(await closed.text()).toContain('SELF_JOIN_CLOSED');

      // ── 2. The organiser turns it on, on screen ───────────────────────────
      await page.goto(`${baseURL}/org/${orgSlug}/events/${event.id}/workshops`);
      const selfJoin = page.getByRole('switch', {
        name: 'People may join this Event by themselves',
      });
      await expect(selfJoin).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
      await selfJoin.click();
      await expect(selfJoin).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(
          async () =>
            (await api.json<{ workshop_self_join?: boolean }>(await api.get(`events/${event.id}`)))
              .workshop_self_join,
          { timeout: 20_000, message: 'the switch must reach the Event' },
        )
        .toBe(true);

      // ── 3. The public list filters by weapon and by instructor ────────────
      const fighterPage = await fighter.context.newPage();
      await fighterPage.goto(`${publicBase}/e/${eventSlug}/workshops`, {
        waitUntil: 'domcontentloaded',
      });
      const lsTitle = fighterPage.getByText(longsword.title, { exact: true });
      const sbTitle = fighterPage.getByText(sabre.title, { exact: true });
      await expect(lsTitle).toBeVisible({ timeout: 30_000 });
      await expect(sbTitle).toBeVisible();

      const weapon = fighterPage.getByRole('combobox', { name: 'Weapon', exact: true });
      await weapon.selectOption('Sabre');
      await expect(sbTitle).toBeVisible();
      await expect(lsTitle).toBeHidden();
      await weapon.selectOption('');

      await fighterPage
        .getByRole('combobox', { name: 'Instructor', exact: true })
        .selectOption(teacherGlobalId!);
      await expect(lsTitle).toBeVisible();
      await expect(sbTitle).toBeHidden();

      // ── 4. The Workshop page, then Register → join and book ───────────────
      await fighterPage.goto(`${publicBase}/e/${eventSlug}/w/${longsword.slug}`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(fighterPage.getByRole('heading', { name: longsword.title })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        fighterPage.getByText(`Teacher${token}`, { exact: false }).first(),
      ).toBeVisible();
      await expect(fighterPage.getByText('Longsword', { exact: true }).first()).toBeVisible();

      await fighterPage.getByRole('button', { name: 'Register' }).click();
      await expect(fighterPage.getByText('Join this event')).toBeVisible({ timeout: 20_000 });
      await fighterPage.getByRole('button', { name: 'Join and book' }).click();

      // On the roster with their own profile, and seated.
      const joinedPersonId = async (): Promise<string | undefined> =>
        (
          await api.json<Array<{ id: string; globalPersonId: string | null }>>(
            await api.get(`events/${event.id}/persons`),
          )
        ).find((p) => p.globalPersonId === fighter.globalPersonId)?.id;
      await expect
        .poll(joinedPersonId, {
          timeout: 20_000,
          message: 'the fighter must be on the roster, linked to their own profile',
        })
        .toBeTruthy();
      const personId = (await joinedPersonId())!;
      await expect
        .poll(
          async () =>
            (
              await api.json<RosterRow[]>(
                await api.get(`workshop-sessions/${longsword.sessionId}/roster`),
              )
            ).find((r) => r.personId === personId)?.status,
          { timeout: 20_000, message: 'joining must also book the tapped session' },
        )
        .toBe('confirmed');

      // ── 5. A second join is a no-op ───────────────────────────────────────
      const again = await fighter.api.json<{ personId: string; joined: string }>(
        await fighter.api.post(`me/events/${event.id}/join`, { data: {} }),
      );
      expect(again, 'a second join must find the same row').toEqual({
        personId,
        joined: 'already',
      });
    } finally {
      await fighter.context.close();
    }
  });
});

/** A published Workshop with one session in 2099. */
async function createWorkshop(
  api: Api,
  eventId: string,
  slug: string,
  weapon: string,
): Promise<{ id: string; slug: string; title: string; sessionId: string }> {
  const title = `E2E ${weapon} workshop ${slug}`;
  const workshop = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/workshops`, {
      data: {
        slug,
        title,
        shortDescription: 'Joining an Event from its Workshop page.',
        capacity: 10,
        durationMinutes: 60,
        weapon,
        status: 'published',
      },
    }),
  );
  const session = await api.json<{ id: string }>(
    await api.post(`workshops/${workshop.id}/sessions`, {
      data: {
        startTime: '2099-07-01T10:00:00.000Z',
        endTime: '2099-07-01T11:00:00.000Z',
        location: `Room ${slug}`,
      },
    }),
  );
  return { id: workshop.id, slug, title, sessionId: session.id };
}
