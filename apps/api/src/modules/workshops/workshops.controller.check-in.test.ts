/**
 * The instructor or a Workshop lead ticks a person present in a session, or clears the tick
 * (operator rulings 539, 541, 545).
 *
 * `PUT workshop-sessions/:id/enrollments/:personId/check-in` with `{ present }`. A seat or a
 * waiting-list place can be ticked; a refused person cannot (409, named). A tap is `hand` from then
 * on, so the front desk never overwrites it. A cancelled session takes no tap (526). The tick
 * changes no booking.
 *
 * Driven through the controller and the real services over seeded tables. The double does not
 * apply writes and ignores projections: each write's filters and each read's SELECT are asserted.
 */
import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const SESSION = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CANCELLED = 'cccccccc-0000-4000-8000-00000000000c';
const TOM = '11111111-0000-4000-8000-000000000001';
const ZOE = '22222222-0000-4000-8000-000000000002';
const MAX = '33333333-0000-4000-8000-000000000003';
const IVY = '44444444-0000-4000-8000-000000000004';
const NOT_BOOKED = '55555555-0000-4000-8000-000000000005';

const booking = (
  id: string,
  session: string,
  row: string,
  status: string,
  checkedInAt: string | null = null,
) => ({
  id,
  workshop_session_id: session,
  user_id: row,
  status,
  position: status === 'waitlisted' ? 1 : null,
  enrolled_at: '2026-11-01T10:00:00Z',
  global_person_id: null,
  checked_in_at: checkedInAt,
  global_persons: null,
});

const BOOKINGS = {
  rows: [
    booking('e-tom', SESSION, TOM, 'confirmed', '2026-11-14T09:02:00Z'),
    booking('e-zoe', SESSION, ZOE, 'waitlisted'),
    booking('e-max', SESSION, MAX, 'refused'),
    booking('e-ivy', SESSION, IVY, 'intent'),
    booking('e-tom-c', CANCELLED, TOM, 'confirmed'),
  ],
};

const TABLES = {
  workshop_sessions: {
    rows: [
      { id: SESSION, workshop_id: 'w-1', status: 'scheduled' },
      { id: CANCELLED, workshop_id: 'w-1', status: 'cancelled' },
    ],
  },
  workshops: { rows: [{ id: 'w-1', event_id: 'event-1' }] },
  events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
  organization_members: {
    rows: [
      { organization_id: 'org-1', user_id: 'u-lead', role: 'workshop_lead' },
      { organization_id: 'org-1', user_id: 'u-referee', role: 'referee' },
    ],
  },
  global_persons: { rows: [{ id: 'gp-instructor', claimed_by_user_id: 'u-instructor' }] },
  workshop_instructors: {
    rows: [{ id: 'wi-1', workshop_id: 'w-1', global_person_id: 'gp-instructor' }],
  },
  persons: {
    rows: [
      {
        id: TOM,
        given_name: 'Tom',
        family_name: 'Martin',
        claimed_by_user_id: 'u-tom',
        clubs: null,
      },
      { id: ZOE, given_name: 'Zoé', family_name: 'Petit', claimed_by_user_id: null, clubs: null },
    ],
  },
};

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopsController;

function build(bookings: TableSeed = BOOKINGS) {
  db = mockSupabase({ ...TABLES, workshop_enrollments: bookings });
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  const workshops = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    {} as never,
    {} as never,
  );
  const enrollment = new EnrollmentService(supabase as never, {} as never, {} as never);
  controller = new WorkshopsController(
    workshops,
    enrollment,
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => build());

const req = (userId: string) =>
  ({ headers: { authorization: `Bearer ${userId}` }, cookies: {} }) as never;

const tap = (personId: string, present: boolean, userId = 'u-lead', session = SESSION) =>
  controller.checkIn(session, personId, { present }, req(userId));

const checkInWrites = () =>
  writesTo(db, 'workshop_enrollments').map((write) => ({
    op: write.op,
    session: scopedTo(write, 'workshop_session_id'),
    person: scopedTo(write, 'user_id'),
    statuses: write.filters.find((f) => f.method === 'in' && f.args[0] === 'status')?.args[1],
    row: write.row as Record<string, unknown>,
  }));

describe('ticking a person present in a session (539, 541, 545)', () => {
  it('is PUT workshop-sessions/:id/enrollments/:personId/check-in, answered 200', () => {
    const handler = WorkshopsController.prototype.checkIn;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'workshop-sessions/:id/enrollments/:personId/check-in',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
  });

  it('ticks a seat: one update of that person in that session, a time, and "hand"', async () => {
    const answer = await tap(TOM, true);

    const writes = checkInWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      op: 'update',
      session: SESSION,
      person: TOM,
      statuses: ['confirmed', 'waitlisted'],
    });
    expect(writes[0]!.row['check_in_source']).toBe('hand');
    expect(typeof writes[0]!.row['checked_in_at']).toBe('string');
    // The update reads back the rows it wrote: none means it hit no live booking.
    expect(selectsFor(db.from, 'workshop_enrollments')[0]).toBe('id, checked_in_at');
    // The double answers with the seeded row, not the written one: the answer is passed through.
    expect(answer).toEqual({ checkedInAt: '2026-11-14T09:02:00Z' });
  });

  it('ticks a waiting-list place: the booking stays on the waiting list', async () => {
    await tap(ZOE, true);

    const [write] = checkInWrites();
    expect(write).toMatchObject({ op: 'update', person: ZOE });
    expect(write!.row).not.toHaveProperty('status');
    expect(write!.row).not.toHaveProperty('position');
  });

  it('clears a tick by hand: no time, and still "hand", so the desk keeps off (545)', async () => {
    await tap(TOM, false);

    expect(checkInWrites()[0]!.row).toEqual({ checked_in_at: null, check_in_source: 'hand' });
  });

  it('refuses a refused person with a named 409 (541)', async () => {
    const refusal = await tap(MAX, true).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      error: 'CheckInRefusedBooking',
    });
  });

  it.each<[string, string]>([
    ['a booking that is not a live one', IVY],
    ['a person with no booking in the session', NOT_BOOKED],
  ])('answers 404 for %s', async (_who, personId) => {
    await expect(tap(personId, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a cancelled session and writes nothing (526)', async () => {
    const refusal = await tap(TOM, true, 'u-lead', CANCELLED).catch((error: unknown) => error);

    expect((refusal as ConflictException).getResponse()).toMatchObject({
      error: 'WorkshopSessionCancelled',
    });
    expect(checkInWrites()).toEqual([]);
  });

  it('throws when the write fails: a failed tick is never read as "no booking"', async () => {
    build([{ data: null, error: { message: 'connection reset' } }]);

    await expect(tap(TOM, true)).rejects.toThrow(/was not written: connection reset/);
  });
});

describe('who may tick: the bar of accept and refuse', () => {
  it.each<[string, string]>([
    ['a Workshop lead of the club', 'u-lead'],
    ["the Workshop's instructor, who holds no club role", 'u-instructor'],
  ])('takes %s', async (_who, userId) => {
    await expect(tap(TOM, true, userId)).resolves.toBeDefined();
  });

  it('refuses a club member below Workshop lead, and writes nothing', async () => {
    await expect(tap(TOM, true, 'u-referee')).rejects.toBeInstanceOf(ForbiddenException);
    expect(checkInWrites()).toEqual([]);
  });
});

describe('the roster says who was ticked', () => {
  it('reads checked_in_at, and answers it as checkedInAt; who ticked stays private', async () => {
    const roster = (await controller.getRoster(SESSION, req('u-lead'))) as Array<
      Record<string, unknown>
    >;

    expect(selectsFor(db.from, 'workshop_enrollments')[0]).toContain('checked_in_at');
    expect(selectsFor(db.from, 'workshop_enrollments')[0]).not.toContain('check_in_source');
    const tom = roster.find((row) => row['personId'] === TOM);
    expect(tom?.['checkedInAt']).toBe('2026-11-14T09:02:00Z');
    expect(roster.find((row) => row['personId'] === ZOE)?.['checkedInAt']).toBeNull();
  });
});
