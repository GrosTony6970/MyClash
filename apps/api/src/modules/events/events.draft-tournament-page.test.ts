/**
 * A draft Tournament of a published Event, on the public Tournament page's two slug reads
 * (operator ruling 127a, bar of rulings 81-83).
 *
 * `…/standings` answered a draft Tournament with its name, weapon and ruleset, and
 * `…/pools-with-matches` with its id, while an unknown slug got a 404. Now a Tournament that is
 * not published, running or completed answers anyone but a member of the Event's club or an
 * ACTIVE staff session of the same Event exactly as an unknown slug does. An insider reads on.
 *
 * These run the real EventsService over seeded tables, through the controller.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const T = (slug: string, status: string) => ({
  id: `id-${slug}`,
  event_id: EVENT_OPEN,
  slug,
  name: `Tournament ${slug}`,
  status,
  weapon: 'longsword',
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  logo_url: null,
  color: null,
  scoring_config_json: null,
});

const VISIBLE = ['running', 'published', 'completed'];
const HIDDEN = ['draft', 'archived'];

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-other', eventId: 'other-event' } },
  { staff: { staffId: 'staff-off', eventId: EVENT_OPEN } },
];
const INSIDERS: Caller[] = [
  { user: 'u-member' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

const SEED: Parameters<typeof mockSupabase>[0] = {
  events: {
    rows: [
      {
        id: EVENT_OPEN,
        slug: 'open',
        status: 'published',
        organization_id: 'org-a',
        event_kind: 'standard',
        timezone: 'Europe/Paris',
      },
    ],
  },
  tournaments: { rows: [...VISIBLE, ...HIDDEN].map((status) => T(status, status)) },
  custom_rulesets: { rows: [] },
  tournament_ruleset_repins: { rows: [] },
  phases: { rows: [] },
  registrations: { rows: [] },
  organization_members: {
    rows: [
      { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
      { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
    ],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      { id: 'staff-off', event_id: EVENT_OPEN, status: 'disabled' },
      { id: 'staff-other', event_id: 'other-event', status: 'active' },
    ],
  },
};

let db: ReturnType<typeof mockSupabase>;
let controller: EventsController;

function build(overrides: Parameters<typeof mockSupabase>[0] = {}) {
  db = mockSupabase({ ...SEED, ...overrides });
  const orgs = new OrganizationsService(db as never);
  const registry = { has: () => false };
  const events = new EventsService(db as never, orgs, {} as never, registry as never);
  controller = new EventsController(
    events,
    db as never,
    {} as never,
    {} as never,
    orgs,
    {} as never,
  );
}

beforeEach(() => build());

function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

/** The answer, or the refusal's status and body, with the slug blanked so two slugs compare. */
async function answer(call: Promise<unknown>, slug: string): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), refused: error.getResponse() };
    },
  );
  return JSON.stringify(result).replaceAll(slug, '<slug>');
}

const ROUTES = {
  standings: (slug: string, r: never) => controller.getPublicTournamentStandings('open', slug, r),
  poolsWithMatches: (slug: string, r: never) =>
    controller.getPublicTournamentPoolsWithMatches('open', slug, r),
};

/** What each route answers a Tournament it shows: its own status, or its own id. */
const SHOWN: Record<keyof typeof ROUTES, (value: unknown, slug: string) => void> = {
  standings: (value, slug) =>
    expect((value as { tournament: { status: string } }).tournament.status).toBe(slug),
  poolsWithMatches: (value, slug) =>
    expect((value as { tournamentId: string }).tournamentId).toBe(`id-${slug}`),
};

const UNKNOWN_ANSWER = {
  status: 404,
  refused: { message: 'Tournament <slug> not found', error: 'Not Found', statusCode: 404 },
};

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s (ruling 127a)', (route) => {
  const call = (slug: string, caller?: Caller) => answer(ROUTES[route](slug, req(caller)), slug);

  it('answers an unknown Tournament with a 404', async () => {
    expect(await call('nope')).toBe(JSON.stringify(UNKNOWN_ANSWER));
  });

  it('shows a published, running or completed Tournament to anyone, asking nobody who they are', async () => {
    for (const slug of VISIBLE) {
      SHOWN[route](await ROUTES[route](slug, req()), slug);
      expect(await call(slug, { user: 'u-stranger' }), slug).toBe(await call(slug));
    }
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });

  it('answers a draft or archived Tournament to outsiders exactly as an unknown one', async () => {
    for (const slug of HIDDEN) {
      for (const caller of STRANGERS) {
        expect(await call(slug, caller), `${slug} ${JSON.stringify(caller)}`).toBe(
          JSON.stringify(UNKNOWN_ANSWER),
        );
      }
    }
  });

  it("answers a draft or archived Tournament to a club member and to the Event's active staff", async () => {
    for (const slug of HIDDEN) {
      for (const caller of INSIDERS) {
        SHOWN[route](await ROUTES[route](slug, req(caller)), slug);
      }
    }
  });

  it("reads the Tournament's status", async () => {
    await call('draft');
    expect(selectsFor(db.from, 'tournaments').every((select) => /\bstatus\b/.test(select))).toBe(
      true,
    );
  });

  it.each([
    ['organization_members', 'membership read failed: connection reset'],
    ['tournaments', 'tournament read failed: connection reset'],
  ])('fails a failed %s read loudly, never as an unknown Tournament', async (table, message) => {
    build({ [table]: { data: null, error: { message: 'connection reset' } } });
    const run = ROUTES[route]('draft', req({ user: 'u-member' }));
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  });
});

/**
 * A hidden EVENT on the same two reads and on the roster (operator ruling 2026-10-13: a test
 * Event follows the rule of a draft, its club reads its public pages). All three read the Event
 * through `getEventBySlug`, which refused a test Event to its own club too. The service door has
 * its own tests; these hold each ROUTE, with a published Tournament inside the hidden Event.
 */
const HIDDEN_EVENTS = [
  { id: 'ev-draft', slug: 'a-draft', status: 'draft', event_kind: 'standard' },
  { id: 'ev-test', slug: 'a-test', status: 'published', event_kind: 'test' },
  { id: 'ev-test-draft', slug: 'a-test-draft', status: 'draft', event_kind: 'test' },
];

const EVENT_READS = {
  standings: (event: string, r: never) =>
    controller.getPublicTournamentStandings(event, 'running', r),
  poolsWithMatches: (event: string, r: never) =>
    controller.getPublicTournamentPoolsWithMatches(event, 'running', r),
  participants: (event: string, r: never) => controller.listParticipants(event, r),
};
const EVENT_READ_NAMES = Object.keys(EVENT_READS) as Array<keyof typeof EVENT_READS>;

describe.each(HIDDEN_EVENTS)('an Event with status $status and kind $event_kind', (event) => {
  beforeEach(() =>
    build({
      events: { rows: [{ ...event, organization_id: 'org-a', timezone: 'Europe/Paris' }] },
      tournaments: { rows: [{ ...T('running', 'running'), event_id: event.id }] },
    }),
  );

  it.each(EVENT_READ_NAMES)(
    '%s answers anyone outside its club exactly as an Event that does not exist',
    async (route) => {
      const unknown = await answer(EVENT_READS[route]('no-such-event', req()), 'no-such-event');
      expect(unknown).toBe(
        JSON.stringify({
          status: 404,
          refused: { message: 'Event "<slug>" not found', error: 'Not Found', statusCode: 404 },
        }),
      );
      for (const caller of [{}, { user: 'u-stranger' }, { user: 'u-owner-b' }]) {
        expect(
          await answer(EVENT_READS[route](event.slug, req(caller)), event.slug),
          JSON.stringify(caller),
        ).toBe(unknown);
      }
    },
  );

  it.each(EVENT_READ_NAMES)('%s answers a member of its club', async (route) => {
    await expect(EVENT_READS[route](event.slug, req({ user: 'u-member' }))).resolves.toBeDefined();
  });

  it.each(EVENT_READ_NAMES)(
    '%s fails loudly when the membership cannot be read, never as "not found"',
    async (route) => {
      build({
        events: { rows: [{ ...event, organization_id: 'org-a', timezone: 'Europe/Paris' }] },
        organization_members: { data: null, error: { message: 'connection reset' } },
      });
      const run = EVENT_READS[route](event.slug, req({ user: 'u-member' }));
      await expect(run).rejects.toThrow('connection reset');
      await expect(run).rejects.not.toBeInstanceOf(HttpException);
    },
  );
});
