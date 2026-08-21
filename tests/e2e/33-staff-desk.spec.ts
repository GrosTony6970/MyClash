import { test, expect, type APIRequestContext } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureRoster } from './_bracket';

/**
 * The staff surfaces that are not the scoring pad: the check-in desk, the gear
 * table, and the personal event pass that ties them together.
 *
 * These shipped on 2026-08-08 (`b55ba3b2`, `f3176377`, `efe05bde`) with no E2E
 * coverage at all. `18-staff-pad` owns the PIN login and the scoring rules; this
 * spec owns everything a volunteer at the door or the gear table touches.
 *
 * ── What this can prove that the unit tests cannot ───────────────────────────
 *
 * `checkin.service.test.ts`, `gear.service.test.ts` and `pass.service.test.ts`
 * are thorough, and deliberately not re-litigated here. A mock cannot lie about
 * its own shape, so it can never tell us:
 *
 *   - the module is WIRED — routes mounted at the real paths, `ParseUUIDPipe` on
 *     the real params, `scan` reachable rather than swallowed by `:personId`;
 *   - a real `mc_staff` cookie round-trips Fastify and the real JWT, and the
 *     role on the ROW gates the real request;
 *   - migrations 0174–0176 are actually DEPLOYED — the UNIQUE index behind an
 *     idempotent double-arrive, and the CHECK behind a reason-less conditional;
 *   - a base64url pass token survives a real HTTP path parameter;
 *   - the weapon chain resolves against the REAL `weapon_catalog`, not a fixture.
 *
 * ── Why it builds its own event ──────────────────────────────────────────────
 *
 * Every other spec shares the throwaway event from `global-setup`. This one must
 * not, for three separate reasons:
 *
 *   1. The roster's next-bout hop assembles a PostgREST `.or()` filter from
 *      EVERY registration id in the event. The shared event ends a full run with
 *      ~200 people and several hundred registrations — a ~22 KB query string,
 *      which a proxy rejects long before PostgREST sees it. A healthy route
 *      would fail here for a reason that has nothing to do with the desk.
 *   2. The desk counts the roster it was sent, so on the shared event the
 *      numbers are meaningless and drift with whatever upstream specs added.
 *      Here the count is exactly the roster this spec created.
 *   3. The roster returns the whole event up to a ceiling of 1000 and reports
 *      `truncated` when it bites. On the shared event that is still one big
 *      answer whose contents nothing in this spec controls.
 *
 * The event is `event_kind: 'test'`, which stays hard-deletable, and this spec
 * deletes it — `global-teardown` only ever removes the run's shared event.
 */

const STAFF = ['1', 'true', 'yes'].includes((process.env.E2E_STAFF ?? '').toLowerCase());

/** Not weak: `isWeakPin` refuses runs, repeats and the classics. */
const PIN = '481902';

/**
 * Capitalised on purpose.
 *
 * The gear table resolves a weapon by `registrations → tournaments.weapon →
 * slugify → weapon_catalog.slug`, and `weapon_catalog` seeds exactly ten slugs
 * (`0017_fighter_profile_links.sql`). Capitalised input proves the slugify hop
 * does real work rather than being an identity function. An INVENTED weapon
 * would fail silently — the fighter still appears with `weapons: []` and there
 * is simply no id to check against — which is why the assertion below names the
 * catalog when the list comes back empty.
 */
const WEAPON = 'Longsword';

interface RosterEntry {
  personId: string;
  givenName: string;
  familyName: string;
  arrived: boolean;
  arrivedAt: string | null;
  via: string | null;
  next: { scheduledAt: string; liceName: string | null } | null;
}

interface WeaponStatus {
  weaponId: string;
  weaponName: string;
  result: 'pass' | 'fail' | 'conditional' | null;
  reason: string | null;
  checkedAt: string | null;
}

interface GearEntry {
  person: RosterEntry;
  weapons: WeaponStatus[];
}

/**
 * Both desks answer with an envelope, never a bare array.
 *
 * `truncated` is how a screen knows its tab counts describe rows a volunteer
 * can actually scroll to.
 */
interface DeskList<T> {
  entries: T[];
  truncated: boolean;
}

/**
 * The whole roster, exactly as the screen fetches it.
 *
 * No `?q=`: the desks search in the browser now, so a spec that filtered on the
 * wire would be testing a code path the product no longer has.
 */
const deskRoster = async (api: Api): Promise<DeskList<RosterEntry>> =>
  api.json<DeskList<RosterEntry>>(await api.get('staff/checkin/roster'));

const gearList = async (api: Api): Promise<DeskList<GearEntry>> =>
  api.json<DeskList<GearEntry>>(await api.get('staff/gear/roster'));

/** What the desk's Arrived tab would show. */
const arrivedCount = (entries: RosterEntry[]): number =>
  entries.filter((entry) => entry.arrived).length;

interface Fixture {
  eventId: string;
  eventSlug: string;
  people: Array<{ id: string; givenName: string; familyName: string }>;
  deskUser: string;
  gearUser: string;
  scoringUser: string;
  scheduledPersonId: string;
}

/**
 * Every event this file creates, so a RETRY cannot leak one.
 *
 * A failed test is retried in a fresh worker, which re-runs `beforeAll` and
 * builds a second event. Tracking only the latest id would strand the first.
 */
const createdEventIds: string[] = [];
let fixture: Fixture | null = null;

test.describe('staff desk', () => {
  test.skip(!STAFF, 'set E2E_STAFF=1 to drive the check-in desk, the gear table and event passes');

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    const { orgId, baseURL } = runContext();
    const ctx = await organizerContext(playwright, baseURL);
    try {
      fixture = await buildFixture(apiFor(ctx), orgId);
    } finally {
      await ctx.dispose();
    }
  });

  test.afterAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    const { baseURL, orgSlug } = runContext();
    const cleanup = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());
    if (createdEventIds.length === 0) return;
    const ctx = await organizerContext(playwright, baseURL);
    for (const id of createdEventIds) {
      if (!cleanup) {
        console.log(`[e2e] desk event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
        continue;
      }
      const res = await ctx.delete(`/api/v1/events/${id}?mode=hard`);
      if (!res.ok()) console.warn(`[e2e] could not delete desk event ${id}: ${res.status()}`);
    }
    await ctx.dispose();
  });

  test('the check-in desk marks arrivals, and undo is a state change not a delete', async ({
    playwright,
  }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { baseURL } = runContext();
    const ctx = await staffContext(playwright, baseURL, f, f.deskUser);
    try {
      const desk = apiFor(ctx);

      // The screen counts what it was sent, so this asserts the same numbers a
      // volunteer reads off the tabs. Exact because this event holds exactly
      // this roster — the whole reason the spec does not share the run event.
      const before = await deskRoster(desk);
      expect(before.entries, 'the desk is sent the roster this spec created').toHaveLength(
        f.people.length,
      );
      expect(before.truncated, 'and this roster is nowhere near the ceiling').toBe(false);
      expect(arrivedCount(before.entries), 'nobody has arrived yet').toBe(0);

      const target = f.people[0]!;
      const found = before.entries.find((r) => r.personId === target.id);
      expect(found, 'the whole roster must carry every fighter, unsearched').toBeTruthy();
      expect(found!.arrived, 'a fighter starts absent').toBe(false);

      // ── Arrive ────────────────────────────────────────────────────────────
      await desk.ok(await desk.post(`staff/checkin/${target.id}/arrive`, { data: {} }));
      expect(
        arrivedCount((await deskRoster(desk)).entries),
        'arriving must move the Arrived tab count',
      ).toBe(1);

      // Twice is not a crash and not a double count. This is the UNIQUE index
      // from 0174 plus the upsert — a real constraint, not a mock's promise.
      await desk.ok(await desk.post(`staff/checkin/${target.id}/arrive`, { data: {} }));
      expect(
        arrivedCount((await deskRoster(desk)).entries),
        'a second scan of the same fighter must be idempotent',
      ).toBe(1);

      // ── Undo ──────────────────────────────────────────────────────────────
      await desk.ok(await desk.post(`staff/checkin/${target.id}/undo`));
      const afterUndo = await deskRoster(desk);
      expect(arrivedCount(afterUndo.entries), 'undo must put the count back').toBe(0);
      const undone = afterUndo.entries.find((r) => r.personId === target.id);
      expect(
        undone,
        'undo flips the state — the fighter must still be on the roster, not deleted',
      ).toBeTruthy();
      expect(undone!.arrived).toBe(false);

      // Someone who is not on this roster at all.
      const offRoster = await desk.post(`staff/checkin/${randomUuid()}/arrive`, { data: {} });
      expect(offRoster.status(), 'a stranger cannot be checked in').toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('the roster says when each fighter is next due on', async ({ playwright }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { baseURL } = runContext();
    const ctx = await staffContext(playwright, baseURL, f, f.deskUser);
    try {
      const desk = apiFor(ctx);
      const { entries } = await deskRoster(desk);

      // This used to be its own screen behind its own endpoint. It is the desk's
      // Not-arrived tab now, which orders by `next` — so the field has to be on
      // the row, and the two-hop registrations to matches query behind it has to
      // survive a real request rather than a mock.
      const entry = entries.find((r) => r.personId === f.scheduledPersonId);
      expect(entry, 'the scheduled fighter must be on the roster').toBeTruthy();
      expect(entry!.next, 'their row must say when they are due on').toBeTruthy();
      expect(entry!.next!.scheduledAt, 'and carry a real timestamp').toBeTruthy();

      // Arriving moves them between tabs — the desk's whole feedback loop.
      await desk.ok(await desk.post(`staff/checkin/${f.scheduledPersonId}/arrive`, { data: {} }));
      const after = await deskRoster(desk);
      const arrived = after.entries.find((r) => r.personId === f.scheduledPersonId);
      expect(arrived!.arrived, 'once they check in they must leave the Not-arrived tab').toBe(true);
      await desk.ok(await desk.post(`staff/checkin/${f.scheduledPersonId}/undo`));
    } finally {
      await ctx.dispose();
    }
  });

  test('the gear table records a result per weapon, and refuses a bare conditional', async ({
    playwright,
  }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { baseURL } = runContext();
    const ctx = await staffContext(playwright, baseURL, f, f.gearUser);
    const organizer = await organizerContext(playwright, baseURL);
    try {
      const gear = apiFor(ctx);
      const gearRoster = await gearList(gear);

      const entry = gearRoster.entries.find((g) => g.person.personId === f.scheduledPersonId);
      expect(entry, 'a registered fighter must appear on the gear table').toBeTruthy();
      expect(
        entry!.weapons.length,
        `no weapon resolved for "${WEAPON}" — the gear table maps tournaments.weapon through ` +
          'slugify onto weapon_catalog.slug, and only the ten seeded slugs resolve',
      ).toBeGreaterThan(0);

      const weapon = entry!.weapons[0]!;
      expect(weapon.result, 'a weapon starts unchecked').toBeNull();

      // The chain, proved end to end: the id the gear table hands back must be a
      // real catalog row, not something the gear service invented for itself.
      const catalog = await apiFor(organizer).json<Array<{ id: string; name: string }>>(
        await apiFor(organizer).get('weapons'),
      );
      expect(
        catalog.some((w) => w.id === weapon.weaponId),
        'the weaponId must be a real weapon_catalog row',
      ).toBe(true);

      // ── A conditional needs a reason — the 0175 CHECK, deployed ───────────
      const bare = await gear.post(`staff/gear/${f.scheduledPersonId}/${weapon.weaponId}`, {
        data: { result: 'conditional' },
      });
      expect(bare.status(), 'a conditional pass with no reason must be refused').toBe(400);
      expect(await bare.text(), 'and must say it needs a reason').toMatch(/reason/i);

      // ── A real result sticks ──────────────────────────────────────────────
      const recorded = await gear.post(`staff/gear/${f.scheduledPersonId}/${weapon.weaponId}`, {
        data: { result: 'pass' },
      });
      expect(recorded.status(), 'recording a result answers 201').toBe(201);

      const after = await gearList(gear);
      const checked = after.entries.find((g) => g.person.personId === f.scheduledPersonId);
      expect(checked!.weapons[0]!.result, 'the result must be readable back').toBe('pass');

      expect(after.entries, 'the gear table sees the same roster as the desk').toHaveLength(
        f.people.length,
      );
      // A fighter is done only once EVERY entered weapon has a result, which is
      // the bar the screen's Pass tab uses too.
      const fullyChecked = after.entries.filter(
        (g) => g.weapons.length > 0 && g.weapons.every((w) => w.result !== null),
      );
      expect(
        fullyChecked.length,
        'the fighter whose only weapon passed now counts',
      ).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
      await organizer.dispose();
    }
  });

  test('a participant issues their own pass and the desk scans it in', async ({ playwright }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { baseURL } = runContext();

    // The participant's jar must carry NO organizer cookie. `resolvePersonId`
    // tries the claimed user first, and the E2E admin can be auto-linked to a
    // person row by the login auto-link — so a stray organizer cookie could
    // issue somebody else's pass entirely.
    const guest = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: undefined,
    });
    const deskCtx = await staffContext(playwright, baseURL, f, f.deskUser);
    try {
      const guestApi = apiFor(guest);
      const passHolder = f.people[1]!;

      // Guest sessions take the event UUID (ParseUUIDPipe); the pass route
      // accepts a slug too. Different param contracts on adjacent routes.
      const session = await guestApi.post(`events/${f.eventId}/guest-sessions`, {
        data: { person_id: passHolder.id },
      });
      expect(session.status(), 'a participant may claim themselves off the roster').toBe(201);

      const pass = await guestApi.json<{ token: string; expiresAt: string | null }>(
        await guestApi.post(`events/${f.eventId}/pass`, { data: {} }),
      );
      expect(pass.token, 'the raw token is returned exactly once, at issue').toBeTruthy();

      // The public preview — what the phone renders offline beside the QR.
      const preview = await guestApi.json<{ givenName: string; familyName: string }>(
        await guestApi.get(`event-passes/${pass.token}`),
      );
      expect(
        { given: preview.givenName, family: preview.familyName },
        'the preview must name the holder',
      ).toEqual({ given: passHolder.givenName, family: passHolder.familyName });

      // ── The desk scans it ─────────────────────────────────────────────────
      const desk = apiFor(deskCtx);
      const scanned = await desk.json<RosterEntry>(
        await desk.post('staff/checkin/scan', { data: { token: pass.token } }),
      );
      expect(scanned.personId, 'the scan must resolve to the pass holder').toBe(passHolder.id);
      expect(scanned.arrived, 'and mark them arrived').toBe(true);
      expect(scanned.via, 'a scanned arrival is recorded as qr, not search').toBe('qr');

      // An unknown token is refused, and says which kind of refusal it is —
      // the scan lane shows a different message for expired vs unrecognised.
      const bogus = await desk.post('staff/checkin/scan', {
        data: { token: 'A'.repeat(43) },
      });
      expect(bogus.status(), 'an unknown pass is a 404').toBe(404);
      expect(await bogus.text(), 'and names the reason').toMatch(/pass_not_recognized/i);

      await desk.ok(await desk.post(`staff/checkin/${passHolder.id}/undo`));
    } finally {
      await guest.dispose();
      await deskCtx.dispose();
    }
  });

  test('each role reaches its own surface and no other', async ({ playwright }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { baseURL } = runContext();

    // The matrix, driven for real rather than asserted against a mocked guard.
    // Three sessions, two surfaces, and the only allowed pairs are the diagonal.
    const cases = [
      { user: f.deskUser, allowed: 'staff/checkin/roster', refused: 'staff/gear/roster' },
      { user: f.gearUser, allowed: 'staff/gear/roster', refused: 'staff/checkin/roster' },
    ] as const;

    for (const c of cases) {
      const ctx = await staffContext(playwright, baseURL, f, c.user);
      try {
        const api = apiFor(ctx);
        expect((await api.get(c.allowed)).status(), `${c.user} must reach ${c.allowed}`).toBe(200);
        const refused = await api.get(c.refused);
        expect(refused.status(), `${c.user} must NOT reach ${c.refused}`).toBe(403);
        expect(await refused.text(), 'and the refusal must name the role').toMatch(
          /role cannot use this surface/i,
        );
      } finally {
        await ctx.dispose();
      }
    }

    // A scoring account reaches neither desk nor gear.
    const scoring = await staffContext(playwright, baseURL, f, f.scoringUser);
    try {
      const api = apiFor(scoring);
      for (const path of ['staff/checkin/roster', 'staff/gear/roster']) {
        expect((await api.get(path)).status(), `a scoring account must not reach ${path}`).toBe(
          403,
        );
      }
    } finally {
      await scoring.dispose();
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function required(f: Fixture | null): Fixture {
  if (!f) throw new Error('[e2e] the desk fixture was never built — see beforeAll');
  return f;
}

/** A UUID that belongs to nobody, for the off-roster refusal. */
function randomUuid(): string {
  return '00000000-0000-4000-8000-0000000000ff';
}

/**
 * An organizer jar. `playwright.request.newContext` inherits NEITHER `baseURL`
 * nor `ignoreHTTPSErrors` from the config, and prod serves a dev cert — both
 * have to be passed explicitly or every call fails at the TLS handshake.
 */
async function organizerContext(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: 'tests/e2e/.auth/admin.json',
  });
}

/** A staff jar, signed in with a PIN. No organizer cookie anywhere near it. */
async function staffContext(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string,
  f: Fixture,
  username: string,
): Promise<APIRequestContext> {
  // `storageState: undefined` is load-bearing, not decoration:
  // `playwright.request.newContext()` INHERITS `use.storageState` from the
  // config, so a jar created without it carries the organizer's
  // `sb-access-token`. Every role refusal below would then be asserted against
  // a session that is also an organizer — and the endpoints with an organizer
  // branch would answer 200 for the wrong reason.
  const ctx = await playwright.request.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: undefined,
  });
  const api = apiFor(ctx);
  await api.ok(
    await api.post('staff-auth/login', {
      data: { eventSlugOrCode: f.eventSlug, eventId: f.eventId, username, pin: PIN },
    }),
  );
  return ctx;
}

/**
 * The desk's own event: a small roster, one tournament whose weapon resolves,
 * one scheduled bout, and one staff account per role.
 */
async function buildFixture(api: Api, orgId: string): Promise<Fixture> {
  const token = Date.now().toString(36);
  const { eventId, eventSlug, people } = await createDeskEvent(api, orgId, token);
  await scheduleOneBout(api, eventId, people, token);
  const accounts = await createStaffAccounts(api, eventId, token);

  return {
    eventId,
    eventSlug,
    people,
    ...accounts,
    scheduledPersonId: people[0]!.id,
  };
}

/** A disposable `test`-kind event with a four-person roster. */
async function createDeskEvent(
  api: Api,
  orgId: string,
  token: string,
): Promise<{ eventId: string; eventSlug: string; people: Fixture['people'] }> {
  const eventSlug = `e2e-desk-${token}`;
  // Future dates on purpose: a pass expires at `end_date + 7 days`, so a past
  // event would mint an already-expired pass and the scan leg would 404.
  const event = await api.json<{ id: string }>(
    await api.post(`organizations/${orgId}/events`, {
      data: {
        name: `E2E TEST (auto) desk — ${token}`,
        slug: eventSlug,
        startDate: '2099-06-01',
        endDate: '2099-06-02',
        city: 'Testville',
        country: 'FR',
        eventKind: 'test',
      },
    }),
  );
  createdEventIds.push(event.id);

  const people = await ensureRoster(api, event.id, [
    { givenName: 'Deskcheck', familyName: `Alpha${token}` },
    { givenName: 'Deskcheck', familyName: `Bravo${token}` },
    { givenName: 'Deskcheck', familyName: `Charlie${token}` },
    { givenName: 'Deskcheck', familyName: `Delta${token}` },
  ]);
  return { eventId: event.id, eventSlug, people };
}

/**
 * A tournament whose weapon resolves, two of the four registered, and one pool
 * match on a Lice at a known time — the only way a roster row's `next` is non-null.
 */
async function scheduleOneBout(
  api: Api,
  eventId: string,
  people: Fixture['people'],
  token: string,
): Promise<void> {
  const tournament = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/tournaments`, {
      data: { name: `Desk Cup ${token}`, slug: `desk-cup-${token}`, weapon: WEAPON, color: 'red' },
    }),
  );
  // Only the first two register: the gear tabs are only interesting when some
  // of the roster has weapons to check and some has none.
  for (const [index, person] of people.slice(0, 2).entries()) {
    await api.ok(
      await api.post(`tournaments/${tournament.id}/registrations`, {
        data: { personId: person.id, seed: index + 1 },
      }),
    );
  }

  const lice = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/lices`, { data: { name: `Desk Piste ${token}` } }),
  );
  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
  );
  // `pools-with-matches` answers a bare ARRAY of pools, not `{ pools: [...] }`.
  const pools = await api.json<Array<{ matches?: Array<{ id: string }> }>>(
    await api.get(`tournaments/${tournament.id}/pools-with-matches`),
  );
  const firstMatch = pools.flatMap((p) => p.matches ?? [])[0];
  expect(firstMatch, 'the desk fixture needs one pool match to schedule').toBeTruthy();
  await api.ok(
    await api.patch(`matches/${firstMatch!.id}/schedule`, {
      data: { liceId: lice.id, scheduledAt: '2099-06-01T10:00:00.000Z' },
    }),
  );
}

/** One account per role, each asserted to have been created with it. */
async function createStaffAccounts(
  api: Api,
  eventId: string,
  token: string,
): Promise<{ deskUser: string; gearUser: string; scoringUser: string }> {
  const deskUser = `desk${token}`.slice(0, 20);
  const gearUser = `gear${token}`.slice(0, 20);
  const scoringUser = `scor${token}`.slice(0, 20);
  for (const [username, role] of [
    [deskUser, 'checkin'],
    [gearUser, 'gear'],
    [scoringUser, 'scoring'],
  ] as const) {
    const created = await api.json<{ role: string }>(
      await api.post(`events/${eventId}/staff-accounts`, {
        data: { displayName: `E2E ${role} ${token}`, username, pin: PIN, role },
      }),
    );
    // `role` is optional on the DTO and the column defaults to `scoring`, so an
    // ignored field would hand every account the wrong surface and the refusal
    // assertions elsewhere would pass for the wrong reason.
    expect(created.role, `the ${role} account must be created with that role`).toBe(role);
  }
  return { deskUser, gearUser, scoringUser };
}
