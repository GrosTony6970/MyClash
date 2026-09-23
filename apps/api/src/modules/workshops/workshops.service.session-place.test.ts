/**
 * A workshop session's venue and area must be the Event's club's own
 * (operator ruling 80).
 *
 * Until 2026-09-23 an edit wrote `venue_id` and `area_id` unchecked, although
 * creating a session checked the venue. A workshop lead of Club A could point a
 * session at Club B's venue, and the Event's public venue list then showed Club
 * B's address, areas and pistes. An area sent without a venue was only checked
 * to exist, on create as on edit.
 *
 * Driven through the real service over seeded tables.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsService } from './workshops.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const WORKSHOP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = '33333333-3333-4333-8333-333333333333';
const BARE_SESSION = '44444444-4444-4444-8444-444444444444';
const LEAD = 'u-lead-a';

let db: ReturnType<typeof mockSupabase>;
let service: WorkshopsService;

const SESSIONS = [
  { id: SESSION, workshop_id: WORKSHOP_A, venue_id: 'venue-a1', area_id: 'area-a1' },
  { id: BARE_SESSION, workshop_id: WORKSHOP_A, venue_id: null, area_id: null },
];

/** `sessions` are the seeded rows; the double answers an upsert's read-back with all of them. */
function build(sessions: Record<string, unknown>[] = SESSIONS) {
  db = mockSupabase({
    events: { rows: [{ id: EVENT_A, organization_id: 'org-a', status: 'published' }] },
    workshops: { rows: [{ id: WORKSHOP_A, event_id: EVENT_A }] },
    workshop_sessions: { rows: sessions },
    venues: {
      rows: [
        { id: 'venue-a1', organization_id: 'org-a' },
        { id: 'venue-a2', organization_id: 'org-a' },
        { id: 'venue-b', organization_id: 'org-b' },
      ],
    },
    venue_areas: {
      rows: [
        { id: 'area-a1', venue_id: 'venue-a1' },
        { id: 'area-a2', venue_id: 'venue-a2' },
        { id: 'area-b', venue_id: 'venue-b' },
      ],
    },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: LEAD, role: 'workshop_lead' }],
    },
  });
  const supabase = { service: db.service };
  const scheduler = { scheduleWorkshopSessionStarting: vi.fn(async () => undefined) };
  const follows = { scheduleWorkshopStarting: vi.fn(async () => undefined) };
  service = new WorkshopsService(
    supabase as never,
    scheduler as never,
    {} as never,
    new OrganizationsService(supabase as never),
    {} as never,
    follows as never,
  );
}

beforeEach(() => build());

const sessionWrites = () => writesTo(db, 'workshop_sessions');

async function refused(write: Promise<unknown>) {
  await expect(write).rejects.toBeInstanceOf(BadRequestException);
  expect(sessionWrites()).toEqual([]);
}

describe('editing a session (ruling 80)', () => {
  it("refuses another club's venue, before writing", async () => {
    await refused(service.updateSession(SESSION, { venueId: 'venue-b' }, LEAD));
  });

  it('refuses a venue that does not exist', async () => {
    await refused(service.updateSession(SESSION, { venueId: 'venue-none' }, LEAD));
  });

  it("refuses an area sent alone that is not in the session's venue", async () => {
    await refused(service.updateSession(SESSION, { areaId: 'area-b' }, LEAD));
    await refused(service.updateSession(SESSION, { areaId: 'area-a2' }, LEAD));
  });

  it('refuses an area of another club on a session with no venue', async () => {
    await refused(service.updateSession(BARE_SESSION, { areaId: 'area-b' }, LEAD));
  });

  it("refuses an area of another club while clearing the session's venue", async () => {
    await refused(service.updateSession(SESSION, { venueId: null, areaId: 'area-b' }, LEAD));
  });

  it("refuses a club's own venue with an area of another venue", async () => {
    await refused(service.updateSession(SESSION, { venueId: 'venue-a2', areaId: 'area-b' }, LEAD));
  });

  it("moves the session to another of the club's venues and areas", async () => {
    await service.updateSession(SESSION, { venueId: 'venue-a2', areaId: 'area-a2' }, LEAD);
    expect(sessionWrites().map((write) => write.row)).toEqual([
      { venue_id: 'venue-a2', area_id: 'area-a2' },
    ]);
  });

  it("takes one of the club's areas on a session with no venue, and clears a venue", async () => {
    await service.updateSession(BARE_SESSION, { areaId: 'area-a1' }, LEAD);
    await service.updateSession(SESSION, { venueId: null, areaId: null }, LEAD);
    // A cleared venue is not the stored one: the area answers to the club alone.
    await service.updateSession(SESSION, { venueId: null, areaId: 'area-a2' }, LEAD);
    expect(sessionWrites().map((write) => write.row)).toEqual([
      { area_id: 'area-a1' },
      { venue_id: null, area_id: null },
      { venue_id: null, area_id: 'area-a2' },
    ]);
  });

  it('reads no venue for an edit that does not move the session', async () => {
    await service.updateSession(SESSION, { location: 'Hall 2' }, LEAD);
    expect(selectsFor(db.from, 'venues')).toEqual([]);
    expect(selectsFor(db.from, 'venue_areas')).toEqual([]);
  });

  it('reads each deciding column', async () => {
    await service.updateSession(SESSION, { areaId: 'area-a1' }, LEAD);
    expect(selectsFor(db.from, 'venue_areas')).toEqual(['venue_id']);
    expect(selectsFor(db.from, 'workshop_sessions')).toContain('venue_id');
    await service.updateSession(SESSION, { venueId: 'venue-a1' }, LEAD);
    expect(selectsFor(db.from, 'venues')).toEqual(['organization_id']);
  });
});

describe('creating a session (ruling 80)', () => {
  beforeEach(() => build([SESSIONS[0]!]));

  it('refuses an area of another club sent without a venue, before writing', async () => {
    await refused(
      service.createSession(
        WORKSHOP_A,
        { startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z', areaId: 'area-b' },
        LEAD,
      ),
    );
  });

  it("takes one of the club's areas sent without a venue", async () => {
    await service.createSession(
      WORKSHOP_A,
      { startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z', areaId: 'area-a1' },
      LEAD,
    );
    expect(sessionWrites()).toHaveLength(1);
  });
});
