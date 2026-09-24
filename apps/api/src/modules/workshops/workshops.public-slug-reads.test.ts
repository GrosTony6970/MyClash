/**
 * The workshop reads a spectator makes by Event slug: the list, the break bars,
 * and one workshop (rulings 81-83).
 *
 * Until 2026-09-24 all three read the Event by slug with no status check, so a
 * DRAFT Event's published workshops and its break bars were public before the
 * Event was. Now a draft Event answers an outsider exactly as an unknown slug
 * does: [] for the two lists, the unknown workshop's 404 for one workshop. A
 * member of the Event's club and an ACTIVE staff session of the same Event
 * still read them.
 *
 * Everything runs for real over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENTS = [
  {
    id: EVENT_OPEN,
    slug: 'open',
    timezone: 'Europe/Paris',
    status: 'published',
    organization_id: 'org-a',
  },
  {
    id: EVENT_DRAFT,
    slug: 'draft',
    timezone: 'Europe/Paris',
    status: 'draft',
    organization_id: 'org-a',
  },
];

/** One published workshop and one break bar per Event, each naming its Event. */
const workshop = (eventId: string) => ({
  id: `w-${eventId}`,
  event_id: eventId,
  slug: 'longsword',
  title: `Longsword at ${eventId}`,
  short_description: null,
  description_md: null,
  category: null,
  level: 'all',
  weapon: null,
  language: 'fr',
  capacity: null,
  duration_minutes: null,
  status: 'published',
  sort_order: 0,
  color: null,
  cover_image_url: null,
  venue_id: null,
  venues: null,
  workshop_sessions: [],
  workshop_instructors: [],
});
const breakBar = (eventId: string) => ({
  id: `b-${eventId}`,
  event_id: eventId,
  day_index: 0,
  start_time: '12:00',
  end_time: '13:00',
  label: `Lunch at ${eventId}`,
  color: null,
});

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopsController;

function build(events: Parameters<typeof mockSupabase>[0][string]) {
  db = mockSupabase({
    events,
    workshops: { rows: [workshop(EVENT_OPEN), workshop(EVENT_DRAFT)] },
    workshop_breaks: { rows: [breakBar(EVENT_OPEN), breakBar(EVENT_DRAFT)] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
        { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
        { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      ],
    },
  });
  // No login cookie reaches getAuthUser in these requests; the guard's identity decides.
  const supabase = { service: db.service, getAuthUser: async () => null };
  const orgs = new OrganizationsService(supabase as never);
  const privacy = { hiddenWorkshopGlobalPersonIds: async () => new Set<string>() };
  const service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    orgs,
    privacy as never,
    {} as never,
  );
  controller = new WorkshopsController(
    service,
    {} as never,
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => build({ rows: EVENTS }));

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

/** A request as the AuthGuard leaves it: the login wins the identity, the staff cookie is kept beside it. */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

/** The answer, or the refusal's status and body. */
async function answer(call: Promise<unknown>): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), refused: error.getResponse() };
    },
  );
  return JSON.stringify(result);
}

const ROUTES = {
  listPublic: (slug: string, r: never) => controller.listPublic(slug, r),
  listPublicBreaks: (slug: string, r: never) => controller.listPublicBreaks(slug, r),
  getPublicBySlug: (slug: string, r: never) => controller.getPublicBySlug('longsword', slug, r),
};

const UNKNOWN_ANSWER: Record<keyof typeof ROUTES, unknown> = {
  listPublic: { value: [] },
  listPublicBreaks: { value: [] },
  getPublicBySlug: {
    status: 404,
    refused: { message: 'Workshop "longsword" not found', error: 'Not Found', statusCode: 404 },
  },
};

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];
const INSIDERS: Caller[] = [
  { user: 'u-member' },
  { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } },
  // The Event's pad, where a stranger once signed in.
  { user: 'u-stranger', staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } },
];

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s (rulings 81-83)', (route) => {
  const call = (slug: string, caller?: Caller) => answer(ROUTES[route](slug, req(caller)));

  it('answers an unknown Event slug as it always has', async () => {
    expect(await call('nope')).toBe(JSON.stringify(UNKNOWN_ANSWER[route]));
  });

  it("shows a published Event's own workshops to anyone, signed out included", async () => {
    const open = await call('open');
    expect(open).toContain(EVENT_OPEN);
    expect(open).not.toContain(EVENT_DRAFT);
    expect(await call('open', { user: 'u-stranger' })).toBe(open);
  });

  it("answers a draft Event's workshops to outsiders exactly as an unknown slug", async () => {
    const unknown = await call('nope');
    for (const caller of STRANGERS) {
      expect(await call('draft', caller), JSON.stringify(caller)).toBe(unknown);
    }
  });

  it("shows a draft Event's own workshops to a club member and to the Event's active staff", async () => {
    for (const caller of INSIDERS) {
      const shown = await call('draft', caller);
      expect(shown, JSON.stringify(caller)).toContain(EVENT_DRAFT);
      expect(shown, JSON.stringify(caller)).not.toContain(EVENT_OPEN);
    }
  });

  it("reads the Event's status and club, and a signed-out read costs no membership read", async () => {
    await call('open');
    await call('draft');
    expect(selectsFor(db.from, 'events')).toEqual([
      'id, timezone, status, organization_id, event_kind',
      'id, timezone, status, organization_id, event_kind',
    ]);
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });

  it('fails a failed Event read loudly, never as an unknown slug', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    await expect(ROUTES[route]('open', req())).rejects.toThrow(
      /^event read failed: connection reset$/,
    );
    await expect(ROUTES[route]('open', req())).rejects.not.toBeInstanceOf(HttpException);
  });
});
