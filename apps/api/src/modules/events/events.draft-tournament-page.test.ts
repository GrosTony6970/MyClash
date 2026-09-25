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
  controller = new EventsController(events, db as never, {} as never, {} as never, orgs);
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
