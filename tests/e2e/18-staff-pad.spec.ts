import { randomUUID } from 'node:crypto';
import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensureRoster, scoreMatch } from './_bracket';

/**
 * The referee's REAL login — a PIN on a shared tablet (run with `E2E_STAFF=1`).
 *
 * Every other scoring spec (`06`, `08`, `10`, `16`) authenticates with the
 * ORGANIZER's cookie from `global-setup`, which takes the FIRST branch of
 * `authorizeMatchScoring` (`staff.service.ts:337`). The second branch — the one
 * an actual referee at a piste goes through — has four rules that nothing in
 * the repo has ever driven:
 *
 *   if (match.eventId !== staff.event_id) throw   // wrong event
 *   if (!match.liceId)                    throw   // match not assigned to a lice
 *   if (!await this.isLiceAssigned(...))  throw   // not YOUR lice
 *   return { staffAccountId, canOverrideLocked: false }   // staff may never override a lock
 *
 * The second of those is a live 403 waiting to happen: a referee whose match the
 * organizer never assigned to a piste simply cannot score it.
 *
 * THE STORAGE STATE IS THE WHOLE TRICK. `playwright.e2e.config.ts` applies the
 * organizer's `storageState` to every context, and the organizer branch wins
 * whenever `sb-access-token` resolves — so a spec that just called the staff
 * login from the shared fixtures would re-prove the branch already covered four
 * times over. Everything staff-side here runs in a context created with
 * `storageState: undefined`, and `context.request` shares that context's cookie
 * jar, so the browser's PIN login is what authenticates the API assertions too.
 *
 * Event-scoped (plus one disposable `event_kind: 'test'` event for the
 * wrong-event case), so `global-teardown` cleans up.
 */
const STAFF = ['1', 'true', 'yes'].includes((process.env.E2E_STAFF ?? '').toLowerCase());

const PIN = '4731';
const WRONG_PIN = '9999';

/** Only the fields this spec reads back off a match row. */
interface MatchRow {
  id: string;
  status: string;
  lice_id: string | null;
  locked_at: string | null;
}

interface PoolMatchRow {
  id: string;
  status: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

/**
 * A refusal, asserted by its REASON.
 *
 * Only a 5xx hides its detail; a 4xx carries the real message in
 * `detail`/`message` (RFC 9457 — "Forbidden" is just the title). Asserting the
 * status alone would let any of these four rules stand in for any other, which
 * is exactly what this spec exists to tell apart.
 */
async function expectRefusal(
  res: APIResponse,
  status: number,
  reason: RegExp,
  label: string,
): Promise<void> {
  const body = await res.text();
  expect(res.status(), `[${label}] status — body was ${body.slice(0, 200)}`).toBe(status);
  expect(body, `[${label}] the server must say WHY`).toMatch(reason);
}

test.describe('staff pad', () => {
  test.skip(!STAFF, 'set E2E_STAFF=1 to drive the referee PIN login and the staff scoring rules');

  test('a referee signs in with a PIN and may score their own lice, and nothing else', async ({
    browser,
    request,
  }) => {
    test.setTimeout(360_000);
    const api = apiFor(request);
    const { eventId, eventSlug, orgId, baseURL } = runContext();
    const token = Date.now().toString(36);
    const scoringBase = (process.env.E2E_SCORING_URL ?? `${baseURL}/scoring`).replace(/\/$/, '');
    const username = `ref${token}`.slice(0, 20);

    // ── Setup, entirely as the ORGANIZER ──────────────────────────────────────
    const mineLice = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/lices`, { data: { name: `Staff Mine ${token}` } }),
    );
    const theirsLice = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/lices`, { data: { name: `Staff Theirs ${token}` } }),
    );

    const account = await api.json<{ id: string; username: string }>(
      await api.post(`events/${eventId}/staff-accounts`, {
        data: { displayName: `E2E Referee ${token}`, username, pin: PIN, role: 'arbitre_table' },
      }),
    );
    // The PIN is caller-chosen on reset too, so a spec can always know it.
    await api.ok(
      await api.post(`events/${eventId}/staff-accounts/${account.id}/reset-pin`, {
        data: { pin: PIN },
      }),
    );
    await api.ok(
      await api.put(`events/${eventId}/staff-accounts/${account.id}/lices`, {
        data: { liceIds: [mineLice.id] },
      }),
    );

    // Three pool matches in one tournament: one on the staff's lice, one on
    // another lice, one left with no lice at all.
    const fighters = await ensureRoster(api, eventId, [
      { givenName: 'Staffpad', familyName: 'One' },
      { givenName: 'Staffpad', familyName: 'Two' },
      { givenName: 'Staffpad', familyName: 'Three' },
      { givenName: 'Staffpad', familyName: 'Four' },
      { givenName: 'Staffpad', familyName: 'Five' },
      { givenName: 'Staffpad', familyName: 'Six' },
    ]);
    const tournament = await createBracketTournament(api, eventId, {
      name: `Staff Pad Cup ${token}`,
      slug: `staff-pad-${token}`,
      fighters,
    });
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 3 } }),
    );
    const matches = await poolMatches(api, tournament.id);
    expect(matches.length, 'three 2-fighter pools must yield three matches').toBe(3);
    const [onMyLice, onAnotherLice, withNoLice] = matches as [
      PoolMatchRow,
      PoolMatchRow,
      PoolMatchRow,
    ];

    await api.ok(
      await api.patch(`matches/${onMyLice.id}/schedule`, { data: { liceId: mineLice.id } }),
    );
    await api.ok(
      await api.patch(`matches/${onAnotherLice.id}/schedule`, { data: { liceId: theirsLice.id } }),
    );
    await api.ok(await api.patch(`matches/${onMyLice.id}/status`, { data: { status: 'running' } }));

    // `withNoLice` is deliberately left alone — generate-pools assigns no lice,
    // which is precisely the state a real event reaches when the organizer has
    // not laid out the pistes yet.
    expect(
      (await readMatch(api, withNoLice.id)).lice_id,
      'the no-lice case is only meaningful if the match really has none',
    ).toBeNull();

    // A match in a DIFFERENT event, for the wrong-event rule. Its own disposable
    // `test`-kind event, which stays hard-deletable with results recorded.
    const other = await anotherEventWithAMatch(api, orgId, token);

    // ── The pad's own login page, in a browser with NO organizer cookie ────────
    const staffContext = await browser.newContext({
      baseURL,
      storageState: undefined,
      ignoreHTTPSErrors: true,
    });

    try {
      const staffApi = apiFor(staffContext.request);
      const page = await staffContext.newPage();

      // A wrong PIN first, so the success below cannot be a session that was
      // already lying around.
      //
      // NEVER `waitUntil: 'networkidle'` anywhere in the scoring app: it holds a
      // live connection and re-requests a service worker the /scoring proxy
      // answers 404, so the network never goes idle and goto hangs until the
      // test times out. `06` and `16` both navigate the pad with a bare goto for
      // this reason; the settle signal is an explicit wait on a real element.
      await page.goto(`${scoringBase}/login`);
      await expect(page.locator('#staffPin')).toBeVisible({ timeout: 30_000 });
      await signIn(page, eventSlug, username, WRONG_PIN);
      await expect(page.getByRole('alert'), 'a wrong PIN must be refused visibly').toBeVisible({
        timeout: 20_000,
      });
      expect(
        (await staffApi.get('staff-auth/me')).status(),
        'a refused PIN must not leave a session behind',
      ).toBe(401);

      // ── The real login ──────────────────────────────────────────────────────
      await signIn(page, eventSlug, username, PIN);

      // Assert the SESSION, not the landing URL: the pad is served both at
      // scoring.<domain> and same-origin under admin.<domain>/scoring, and the
      // session is the contract either way.
      await expect
        .poll(async () => (await staffApi.get('staff-auth/me')).status(), {
          timeout: 30_000,
          message: 'the PIN login never produced a staff session',
        })
        .toBe(200);
      const me = await staffApi.json<StaffMe>(await staffApi.get('staff-auth/me'));

      expect(
        { type: me.type, username: me.account.username, event: me.account.event_id },
        'the session must name the account that logged in, on its own event',
      ).toEqual({ type: 'staff', username: username.toLowerCase(), event: eventId });

      // `me` and the dedicated endpoint must agree on what this tablet may run —
      // the pad reads one, the organizer's board reads the other.
      const assigned = await staffApi.json<Array<{ id: string; name: string }>>(
        await staffApi.get('staff/assigned-lices'),
      );
      expect(
        assigned.map((l) => l.id),
        'assigned-lices must be exactly the lice the organizer granted',
      ).toEqual([mineLice.id]);
      expect(
        me.lices.map((l) => l.id),
        'staff-auth/me must agree with staff/assigned-lices',
      ).toEqual([mineLice.id]);

      // ── The referee actually scores, through the pad ─────────────────────────
      await page.goto(`${scoringBase}/matches/${onMyLice.id}`);
      await expect(page.getByTestId('network-bar')).toHaveAttribute('data-network', 'online', {
        timeout: 30_000,
      });
      const cleanHit = page
        .locator('[data-testid="scoring-column"][data-side="red"]')
        .getByTestId('clean-hit-button')
        .filter({ hasText: '+2' })
        .first();
      await expect(cleanHit, 'the pad must be scorable by the staff session').toBeEnabled({
        timeout: 30_000,
      });
      await cleanHit.click();

      await expect
        .poll(async () => (await readMatch(api, onMyLice.id)).status, { timeout: 20_000 })
        .toBe('running');
      await expect
        .poll(async () => await exchangeCount(api, onMyLice.id), {
          timeout: 20_000,
          message: 'the staff-session hit never reached the server',
        })
        .toBe(1);

      // ── The three refusals, told apart by their reasons ──────────────────────
      await expectRefusal(
        await postHit(staffApi, onAnotherLice.id),
        403,
        /not assigned to this Lice/i,
        'another lice',
      );
      await expectRefusal(
        await postHit(staffApi, withNoLice.id),
        403,
        /no assigned Lice/i,
        'no lice',
      );
      await expectRefusal(
        await postHit(staffApi, other.matchId),
        403,
        /Wrong staff event/i,
        'another event',
      );
      // None of them may have left a row behind.
      for (const [label, id] of [
        ['another lice', onAnotherLice.id],
        ['no lice', withNoLice.id],
        ['another event', other.matchId],
      ] as const) {
        expect(await exchangeCount(api, id), `[${label}] a refused hit must not persist`).toBe(0);
      }

      // ── A LOCK is the one thing staff may never override ─────────────────────
      const lock = await aLockingTournament(api, eventId, mineLice.id, token);

      // With auto-lock ENABLED, reopening is an organizer act — the staff
      // session carries no Supabase user at all, so it cannot even be considered.
      await expectRefusal(
        await staffApi.post(`matches/${lock.matchId}/unlock`),
        401,
        /Organizer session required/i,
        'staff unlock while auto-lock is on',
      );

      // Play it out as the organizer so the pool group completes, then wait for
      // MatchAutoLockService — a 60s interval, so this also happens to be the
      // only test that proves the auto-lock scan runs in production at all.
      await scoreMatch(api, lock.matchId, 'red');
      await expect
        .poll(async () => (await readMatch(api, lock.matchId)).locked_at, {
          timeout: 120_000,
          intervals: [5_000],
          message:
            'the completed pool never auto-locked. MatchAutoLockService runs on a 60s interval and ' +
            'skips a group whose latest ended_at is null — check that point-cap completion stamps it.',
        })
        .not.toBeNull();

      await expectRefusal(
        await postHit(staffApi, lock.matchId),
        400,
        /Match is locked/i,
        'staff scoring a locked match',
      );
      // The organizer can, which is what makes the refusal above a RULE and not
      // just a broken endpoint.
      await api.ok(await api.post(`matches/${lock.matchId}/unlock`));
      expect((await readMatch(api, lock.matchId)).locked_at).toBeNull();

      // …and when the organizer turns auto-lock OFF, the piste staff running the
      // match may reopen it themselves (`authorizeMatchUnlock`'s other branch).
      await api.ok(
        await api.patch(`tournaments/${lock.tournamentId}`, {
          data: { lockConfig: { autoLockEnabled: false } },
        }),
      );
      await api.ok(await staffApi.post(`matches/${lock.matchId}/unlock`));

      // ── The session ends when the tablet signs out ───────────────────────────
      await staffApi.ok(await staffApi.post('staff-auth/logout'));
      expect(
        (await staffApi.get('staff-auth/me')).status(),
        'logout must actually end the session',
      ).toBe(401);

      // ── A disabled account cannot get back in ────────────────────────────────
      await api.ok(
        await api.patch(`events/${eventId}/staff-accounts/${account.id}`, {
          data: { status: 'disabled' },
        }),
      );
      await expectRefusal(
        await staffApi.post('staff-auth/login', {
          data: { eventSlugOrCode: eventSlug, username, pin: PIN },
        }),
        403,
        /disabled/i,
        'disabled account',
      );
    } finally {
      await staffContext.close();
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface StaffMe {
  type: string;
  account: { id: string; username: string; event_id: string };
  lices: Array<{ id: string; name: string }>;
}

/** Fill and submit the PIN form on the pad's own login page. */
async function signIn(page: Page, eventSlug: string, username: string, pin: string): Promise<void> {
  await page.fill('#eventSlugOrCode', eventSlug);
  await page.fill('#staffUsername', username);
  await page.fill('#staffPin', pin);
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
}

const readMatch = async (api: Api, matchId: string): Promise<MatchRow> =>
  api.json<MatchRow>(await api.get(`matches/${matchId}`));

const exchangeCount = async (api: Api, matchId: string): Promise<number> =>
  (await api.json<unknown[]>(await api.get(`matches/${matchId}/exchanges`))).length;

/** One clean hit, composed the way the pad composes it. */
function postHit(api: Api, matchId: string): Promise<APIResponse> {
  return api.post(`matches/${matchId}/exchanges`, {
    data: {
      clientUuid: randomUUID(),
      sequence: 1,
      type: 'clean',
      occurredAt: new Date().toISOString(),
      clockTimeMs: 1_000,
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
    },
  });
}

/** Every playable match of a tournament's pools, in pool order. */
async function poolMatches(api: Api, tournamentId: string): Promise<PoolMatchRow[]> {
  const pools = await api.json<Array<{ matches?: PoolMatchRow[] }>>(
    await api.get(`tournaments/${tournamentId}/pools-with-matches`),
  );
  return pools
    .flatMap((p) => p.matches ?? [])
    .filter((m) => m.red_registration_id && m.blue_registration_id && m.status !== 'completed');
}

/**
 * A 1-match tournament whose pool auto-locks the moment it completes, on the
 * staff's own lice — so the only thing standing between the staff session and
 * that match is the lock itself.
 */
async function aLockingTournament(
  api: Api,
  eventId: string,
  liceId: string,
  token: string,
): Promise<{ tournamentId: string; matchId: string }> {
  const fighters = await ensureRoster(api, eventId, [
    { givenName: 'Stafflock', familyName: 'One' },
    { givenName: 'Stafflock', familyName: 'Two' },
  ]);
  const tournament = await createBracketTournament(api, eventId, {
    name: `Staff Lock Cup ${token}`,
    slug: `staff-lock-${token}`,
    fighters,
  });
  // Delay 0 so the very next scan locks it; pools only, so nothing else here
  // is affected.
  await api.ok(
    await api.patch(`tournaments/${tournament.id}`, {
      data: {
        lockConfig: {
          autoLockEnabled: true,
          autoLockCompletedPools: true,
          autoLockDelayMinutes: 0,
        },
      },
    }),
  );
  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
  );
  const [match] = await poolMatches(api, tournament.id);
  expect(match, 'the lock tournament produced no playable match').toBeDefined();
  await api.ok(await api.patch(`matches/${match!.id}/schedule`, { data: { liceId } }));
  await api.ok(await api.patch(`matches/${match!.id}/status`, { data: { status: 'running' } }));
  return { tournamentId: tournament.id, matchId: match!.id };
}

/**
 * A match in a DIFFERENT event, for `match.eventId !== staff.event_id`.
 *
 * Its own `event_kind: 'test'` event rather than a second tournament in the
 * shared one — the rule is about the EVENT, so nothing else would exercise it —
 * and `test` is the kind that stays hard-deletable once results exist.
 */
async function anotherEventWithAMatch(
  api: Api,
  orgId: string,
  token: string,
): Promise<{ eventId: string; matchId: string }> {
  const event = await api.json<{ id: string }>(
    await api.post(`organizations/${orgId}/events`, {
      data: {
        name: `E2E TEST (auto) staff-other — ${token}`,
        slug: `e2e-staff-other-${token}`,
        startDate: '2099-06-01',
        endDate: '2099-06-02',
        city: 'Testville',
        country: 'FR',
        eventKind: 'test',
      },
    }),
  );
  await api.ok(
    await api.post(`events/${event.id}/lices`, { data: { name: `Other Lice ${token}` } }),
  );
  const fighters = await ensureRoster(api, event.id, [
    { givenName: 'Staffother', familyName: 'One' },
    { givenName: 'Staffother', familyName: 'Two' },
  ]);
  const tournament = await createBracketTournament(api, event.id, {
    name: `Staff Other Cup ${token}`,
    slug: `staff-other-${token}`,
    fighters,
  });
  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
  );
  const [match] = await poolMatches(api, tournament.id);
  expect(match, 'the other-event tournament produced no playable match').toBeDefined();
  return { eventId: event.id, matchId: match!.id };
}
