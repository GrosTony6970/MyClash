import { expect, type APIRequestContext } from '@playwright/test';
import { apiFor, type Api } from './_api';
import { ensureRoster } from './_bracket';

/**
 * The desk's own Event, shared by `33-staff-desk` (the API) and
 * `44-desk-screens` (the screens a volunteer taps).
 *
 * Why the desk specs build their own Event rather than use the shared one is in
 * `33`'s header: the roster's next-bout filter outgrows a proxy on the shared
 * Event, and the desk counts would drift with whatever other specs added.
 *
 * The Event is `club` kind and published, with its Tournament published too: a
 * participant who mints a guest session is outside the organisation, and to
 * them a `test` Event is hidden (`isPublicEvent`) and a person entered only in a
 * draft Tournament is unknown (`hiddenEntrantIds`). A club Event publishes
 * silently and stays hard-deletable.
 */

/** Not weak: `isWeakPin` refuses runs, repeats and the classics. */
export const PIN = '481902';

/**
 * Capitalised on purpose.
 *
 * The gear table resolves a weapon by `registrations → tournaments.weapon →
 * slugify → weapon_catalog.slug`, and `weapon_catalog` seeds exactly ten slugs
 * (`0017_fighter_profile_links.sql`). Capitalised input proves the slugify hop
 * does real work rather than being an identity function. An INVENTED weapon
 * would fail silently — the fighter still appears with `weapons: []` and there
 * is simply no id to check against.
 */
export const WEAPON = 'Longsword';

export interface DeskFixture {
  eventId: string;
  eventSlug: string;
  /** Four people. Only the first two are entered in the Desk Cup. */
  people: Array<{ id: string; givenName: string; familyName: string }>;
  /** The Tournament's name, shown on the desk's next-bout line. */
  tournamentName: string;
  /** The piste's name, shown on the desk's next-bout line. */
  liceName: string;
  deskUser: string;
  gearUser: string;
  scoringUser: string;
  /** The one person with a scheduled bout: people[0]. */
  scheduledPersonId: string;
}

/**
 * An organizer jar. `playwright.request.newContext` inherits NEITHER `baseURL`
 * nor `ignoreHTTPSErrors` from the config, and prod serves a dev cert — both
 * have to be passed explicitly or every call fails at the TLS handshake.
 */
export async function organizerContext(
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
export async function staffContext(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string,
  f: DeskFixture,
  username: string,
): Promise<APIRequestContext> {
  // `storageState: undefined` is load-bearing, not decoration:
  // `playwright.request.newContext()` INHERITS `use.storageState` from the
  // config, so a jar created without it carries the organizer's
  // `sb-access-token`. Every role refusal would then be asserted against a
  // session that is also an organizer — and the endpoints with an organizer
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
 * The desk's own Event: a small roster, one Tournament whose weapon resolves,
 * one scheduled bout, and one staff account per role.
 *
 * `createdEventIds` receives the Event's id the moment it exists, so a later
 * failure in the build — or a retry, which builds a second Event — cannot leak it.
 */
export async function buildDeskFixture(
  api: Api,
  orgId: string,
  createdEventIds: string[],
): Promise<DeskFixture> {
  const token = Date.now().toString(36);
  const { eventId, eventSlug, people } = await createDeskEvent(api, orgId, token, createdEventIds);
  const { tournamentName, liceName } = await scheduleOneBout(api, eventId, people, token);
  const accounts = await createStaffAccounts(api, eventId, token);

  return {
    eventId,
    eventSlug,
    people,
    tournamentName,
    liceName,
    ...accounts,
    scheduledPersonId: people[0]!.id,
  };
}

/**
 * Delete the desk Events with `E2E_CLEANUP`; otherwise flip each to `test`, so it
 * leaves the public site and stays inspectable by the organisation.
 */
export async function disposeDeskEvents(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string,
  orgSlug: string,
  createdEventIds: readonly string[],
): Promise<void> {
  if (createdEventIds.length === 0) return;
  const cleanup = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());
  const ctx = await organizerContext(playwright, baseURL);
  for (const id of createdEventIds) {
    if (!cleanup) {
      const hidden = await ctx.patch(`/api/v1/events/${id}`, { data: { eventKind: 'test' } });
      if (!hidden.ok()) console.warn(`[e2e] could not hide desk event ${id}: ${hidden.status()}`);
      console.log(`[e2e] desk event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
      continue;
    }
    const res = await ctx.delete(`/api/v1/events/${id}?mode=hard`);
    if (!res.ok()) console.warn(`[e2e] could not delete desk event ${id}: ${res.status()}`);
  }
  await ctx.dispose();
}

/** A disposable, published `club`-kind event with a four-person roster. */
async function createDeskEvent(
  api: Api,
  orgId: string,
  token: string,
  createdEventIds: string[],
): Promise<{ eventId: string; eventSlug: string; people: DeskFixture['people'] }> {
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
        // Public to the participant of the pass leg, and silent on publish.
        eventKind: 'club',
      },
    }),
  );
  createdEventIds.push(event.id);
  // Published, as at a real venue. A participant picks themselves off the roster
  // for the pass leg, and a draft Event's roster is its organisation's alone:
  // the guest-session mint refuses a draft to anyone outside it.
  await api.ok(await api.post(`events/${event.id}/publish`, { data: {} }));

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
  people: DeskFixture['people'],
  token: string,
): Promise<{ tournamentName: string; liceName: string }> {
  const tournamentName = `Desk Cup ${token}`;
  const liceName = `Desk Piste ${token}`;
  const tournament = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/tournaments`, {
      data: { name: tournamentName, slug: `desk-cup-${token}`, weapon: WEAPON, color: 'red' },
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
    await api.post(`events/${eventId}/lices`, { data: { name: liceName } }),
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
  // Published last, as an organiser does once the draw is set. A person entered
  // only in a draft Tournament reads as unknown outside the organisation, and
  // the pass holder is entered in this one alone.
  await api.ok(await api.post(`tournaments/${tournament.id}/publish`, { data: {} }));
  return { tournamentName, liceName };
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
