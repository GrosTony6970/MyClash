/**
 * The person page's three reads (ruling 129 family 8, the bar of rulings 81-83 and 127; rulings
 * 167, 168): the header `GET /events/:eventId/people/:personId`, the schedule
 * `GET /events/:eventId/people/:personId/schedule` and a follow `POST /events/:eventId/follows`
 * answer a person entered ONLY in Tournaments hidden from the caller exactly as an unknown person,
 * for anyone but a member of the Event's club or an ACTIVE staff session of the same Event. A
 * referee or instructor of the Event stays: they are public through that role. One gate owns it:
 * `readEventPerson`.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { PublicScheduleService } from '../persons/public-schedule.service';
import { FollowsService } from './follows.service';
import { PublicPersonService } from './public-person.service';

// The schedule's own reads beyond the gate: proven by their own tests.
vi.mock('../schedule/duty-windows', () => ({
  resolveDutyWindows: vi.fn(async () => new Map()),
  resolvePoolSpans: vi.fn(async () => []),
}));

const EVENT = '11111111-1111-4111-8111-111111111111';
const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // the draft only
const REF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // the draft only, but referees the Event
const NOBODY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const person = (id: string, globalId: string) => ({
  id,
  event_id: EVENT,
  given_name: 'Léa',
  family_name: 'Martin',
  global_person_id: globalId,
  clubs: null,
});

const SEED: Record<string, TableSeed> = {
  events: {
    rows: [{ id: EVENT, status: 'published', organization_id: 'org-a', event_kind: 'standard' }],
  },
  tournaments: { rows: [{ id: 't-secret', event_id: EVENT, status: 'draft', name: 'Longsword' }] },
  persons: { rows: [person(LEA, 'gp-lea'), person(REF, 'gp-ref')] },
  registrations: {
    rows: [
      { id: 'r-lea', person_id: LEA, tournament_id: 't-secret', status: 'registered' },
      { id: 'r-ref', person_id: REF, tournament_id: 't-secret', status: 'registered' },
    ],
  },
  event_referees: { rows: [{ event_id: EVENT, person_id: 'gp-ref' }] },
  event_instructors: { rows: [] },
  global_persons: { rows: [] },
  follows: {
    rows: [],
    returning: (row) => ({ ...row, id: 'f-new', created_at: '2026-09-25T20:00:00Z' }),
  },
  matches: { rows: [] },
  referee_assignments: { rows: [] },
  workshop_enrollments: { rows: [] },
  organization_members: {
    rows: [{ organization_id: 'org-a', user_id: 'u-member', role: 'read_only' }],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-e1', event_id: EVENT, status: 'active' },
      { id: 'staff-off', event_id: EVENT, status: 'disabled' },
      { id: 'staff-e2', event_id: 'e2', status: 'active' },
    ],
  },
};

function build(overrides: Record<string, TableSeed> = {}) {
  const db = mockSupabase({ ...SEED, ...overrides });
  const orgs = new OrganizationsService(db as never);
  const privacy = new PrivacyService(db as never);
  const follows = new FollowsService(db as never, privacy, {} as never, orgs);
  const header = new PublicPersonService(db as never, orgs, privacy, follows);
  const schedule = new PublicScheduleService(db as never, privacy, orgs);
  return {
    db,
    reads: {
      header: (id: string, reader: PublicReader) =>
        header.getProfile(EVENT, id, reader, () => Promise.resolve({})),
      schedule: (id: string, reader: PublicReader) =>
        schedule.getPublicSchedule(EVENT, id, () => Promise.resolve(null), reader),
      follow: (id: string, reader: PublicReader) =>
        follows.followInEvent(EVENT, id, { userId: 'u-fan' }, reader),
    },
  };
}

const ANON: PublicReader = { userId: ANONYMOUS_USER_ID, staff: null };
const asUser = (userId: string): PublicReader => ({ userId, staff: null });
const asStaff = (staffId: string, eventId: string): PublicReader => ({
  userId: ANONYMOUS_USER_ID,
  staff: { staffId, eventId } as PublicReader['staff'],
});
const ROUTES = ['header', 'schedule', 'follow'] as const;
const outcome = (run: Promise<unknown>) =>
  run.then(
    () => 'answered',
    (error: unknown) => error,
  );

describe.each(ROUTES)('the person page %s (ruling 129, 167)', (route) => {
  it.each([
    ['a signed-out caller', ANON],
    ['a member of another club', asUser('u-stranger')],
    ["another Event's staff", asStaff('staff-e2', 'e2')],
    ['a disabled staff session', asStaff('staff-off', EVENT)],
  ])('answers %s a draft-only entrant exactly as an unknown person', async (_who, reader) => {
    const run = build();
    const hidden = await outcome(run.reads[route](LEA, reader));
    const unknown = await outcome(build().reads[route](NOBODY, reader));
    expect(hidden).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect((hidden as Error).message).toBe(`Person "${LEA}" not found`);
    expect((unknown as Error).message).toBe(`Person "${NOBODY}" not found`);
    // A refused follow writes nothing: the gate comes before the follow.
    expect(writesTo(run.db, 'follows')).toEqual([]);
  });

  it.each([
    ["a member of the Event's club", asUser('u-member')],
    ["the Event's active staff session", asStaff('staff-e1', EVENT)],
  ])('answers %s', async (_who, reader) => {
    expect(await outcome(build().reads[route](LEA, reader))).toBe('answered');
  });

  it('answers anyone a referee of the Event, though entered only in the draft', async () => {
    expect(await outcome(build().reads[route](REF, ANON))).toBe('answered');
  });

  it('reads the Event through the one gate', async () => {
    const { db, reads } = build();
    await outcome(reads[route](LEA, ANON));
    expect(selectsFor(db.from, 'events')[0]).toBe('status, organization_id, event_kind');
  });

  it.each(['tournaments', 'registrations', 'event_referees'])(
    'fails a failed %s read as a 5xx, never as "unknown"',
    async (table) => {
      const failed = await outcome(
        build({ [table]: { data: null, error: { message: 'boom' } } }).reads[route](LEA, ANON),
      );
      expect(failed).toBeInstanceOf(Error);
      expect(failed).not.toBeInstanceOf(HttpException);
    },
  );
});
