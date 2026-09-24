/**
 * A TEST Event (`event_kind = 'test'`) is hidden like a draft on the public reads
 * that gate on `canReadEvent` (operator ruling 97): the Workshop slug reads, the
 * venue reads and the theme. The public Event page already answers a test
 * Event as an unknown one, but these reads still showed it to anyone. Now an
 * outsider gets exactly the unknown answer; a member of the Event's organization
 * and an ACTIVE staff session of the Event still read it, so the web-admin pages
 * keep working. The public league page's member-Event list drops a test Event
 * for everyone, as it drops a draft (rulings 88, 97).
 *
 * Driven through the real services over seeded tables. The three Workshop slug
 * reads share `resolveEventBySlug`, and the two venue reads `readableEvent`, so
 * one read of each stands for its siblings.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase } from '../testing/supabase-chain';
import { EventThemesService } from '../../modules/events/event-themes.service';
import { LeaguesService } from '../../modules/leagues/leagues.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { VenuesService } from '../../modules/venues/venues.service';
import { WorkshopsService } from '../../modules/workshops/workshops.service';
import type { PublicReader } from './competition-visibility';

const ORG = '11111111-1111-4111-8111-111111111111';
const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_TEST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEAGUE = '22222222-2222-4222-8222-222222222222';
const NOBODY = '99999999-9999-4999-8999-999999999999';

const event = (id: string, slug: string, kind: string) => ({
  id,
  slug,
  name: `Event ${slug}`,
  organization_id: ORG,
  status: 'published',
  event_kind: kind,
  timezone: 'Europe/Paris',
  logo_url: null,
  start_date: '2026-10-01',
  end_date: null,
  organizations: { id: ORG, name: 'Salle A' },
});
const EVENTS = [event(EVENT_OPEN, 'open', 'standard'), event(EVENT_TEST, 'trial', 'test')];
const perEvent = <T>(make: (eventId: string) => T) => EVENTS.map((e) => make(e.id));

const TABLES = {
  events: { rows: EVENTS },
  workshop_breaks: {
    rows: perEvent((eventId) => ({
      id: `b-${eventId}`,
      event_id: eventId,
      day_index: 0,
      start_time: '12:00',
      end_time: '13:00',
      label: `Lunch at ${eventId}`,
      color: null,
    })),
  },
  venues: {
    rows: perEvent((eventId) => ({
      id: `hall-${eventId}`,
      organization_id: ORG,
      name: `Hall of ${eventId}`,
      venue_areas: [],
      venue_lices: [],
    })),
  },
  event_venues: {
    rows: perEvent((eventId) => ({ event_id: eventId, venue_id: `hall-${eventId}` })),
  },
  lices: { rows: [] },
  workshop_sessions: { rows: [] },
  themes: {
    rows: perEvent((eventId) => ({ id: `theme-${eventId}`, event_id: eventId })),
  },
  leagues: { rows: [{ id: LEAGUE, status: 'published', public_visibility: true }] },
  league_tournament_links: {
    rows: EVENTS.map((e) => ({
      league_id: LEAGUE,
      status: 'approved',
      tournaments: { event_id: e.id, events: e },
    })),
  },
  organization_members: {
    rows: [{ organization_id: ORG, user_id: 'u-member', role: 'read_only' }],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-test', event_id: EVENT_TEST, status: 'active' },
      { id: 'staff-off', event_id: EVENT_TEST, status: 'disabled' },
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
    ],
  },
};

let services: {
  workshops: WorkshopsService;
  venues: VenuesService;
  themes: EventThemesService;
  leagues: LeaguesService;
};

beforeEach(() => {
  const db = mockSupabase(TABLES);
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(supabase as never);
  const privacy = { hiddenWorkshopGlobalPersonIds: async () => new Set<string>() };
  services = {
    workshops: new WorkshopsService(
      supabase as never,
      {} as never,
      {} as never,
      orgs,
      privacy as never,
      {} as never,
    ),
    venues: new VenuesService(supabase as never, orgs),
    themes: new EventThemesService(supabase as never, orgs, {} as never),
    leagues: new LeaguesService(supabase as never, orgs, {} as never),
  };
});

const reader = (userId: string, staff: PublicReader['staff'] = null): PublicReader => ({
  userId,
  staff,
});
const OUTSIDERS: Array<[string, PublicReader]> = [
  ['a signed-out caller', reader('anonymous')],
  ['a stranger', reader('u-stranger')],
  [
    'a staff login of another Event',
    reader('anonymous', { staffId: 'staff-open', eventId: EVENT_OPEN }),
  ],
  ['a disabled staff session', reader('anonymous', { staffId: 'staff-off', eventId: EVENT_TEST })],
];
const INSIDERS: Array<[string, PublicReader]> = [
  ['a member of its organization', reader('u-member')],
  ['its active staff', reader('anonymous', { staffId: 'staff-test', eventId: EVENT_TEST })],
];

/** The answer, or the refusal's status and body, with the ref blanked so two refs compare. */
async function answer(call: Promise<unknown>, ref: string): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), refused: error.getResponse() };
    },
  );
  return JSON.stringify(result).replaceAll(ref, '<ref>');
}

interface Read {
  call: (ref: string, r: PublicReader) => Promise<unknown>;
  test: string;
  open: string;
  unknown: string;
}
const READS: Record<string, Read> = {
  'Workshop breaks by Event slug': {
    call: (slug, r) => services.workshops.listPublicWorkshopBreaks(slug, r),
    test: 'trial',
    open: 'open',
    unknown: 'nope',
  },
  'venues by Event id': {
    call: (id, r) => services.venues.listForVisibleEvent(id, r),
    test: EVENT_TEST,
    open: EVENT_OPEN,
    unknown: NOBODY,
  },
  'the Event theme': {
    call: (id, r) => services.themes.getTheme(id, r),
    test: EVENT_TEST,
    open: EVENT_OPEN,
    unknown: NOBODY,
  },
};

describe.each(Object.keys(READS))('%s (ruling 97)', (name) => {
  const read = READS[name]!;
  const run = (ref: string, r: PublicReader) => answer(read.call(ref, r), ref);

  it.each(OUTSIDERS)('answers a test Event to %s exactly like an unknown one', async (_l, r) => {
    expect(await run(read.test, r)).toBe(await run(read.unknown, r));
  });

  it.each(INSIDERS)('shows a test Event to %s as it shows a standard one', async (_l, r) => {
    const shown = (await run(read.test, r)).replaceAll(EVENT_TEST, '<event>');
    const standard = (await run(read.open, r)).replaceAll(EVENT_OPEN, '<event>');
    expect(shown).toBe(standard);
    expect(shown).not.toBe(await run(read.unknown, r));
  });
});

describe("a public league's member Events (rulings 88, 97)", () => {
  it('leaves a test Event out, for everyone', async () => {
    const listed = await services.leagues.listLeagueMemberEvents(LEAGUE);
    expect(listed.map((e) => e.id)).toEqual([EVENT_OPEN]);
  });
});
