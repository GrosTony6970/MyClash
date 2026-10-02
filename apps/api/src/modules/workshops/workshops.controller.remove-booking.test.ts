/**
 * An organiser's "Remove" in a Workshop roster deletes the LISTED person's booking (operator
 * ruling 214).
 *
 * The web-admin roster called `DELETE workshop-sessions/:id/enroll`, the participant's own
 * door: it cancelled the booking of whoever clicked, and left the listed person in. The
 * organiser's door is `DELETE workshop-sessions/:id/enrollments/:personId`, at the bar of the
 * route that adds a person (`workshop_lead` on the session's own Event). It deletes the booking
 * whatever its state, so the person may book again; a freed seat goes to the next person waiting.
 *
 * Driven through the controller and the real services. The tables are seeded; where a test is
 * about a failed or raced write, the bookings are a canned queue (their answers in call order).
 */
import 'reflect-metadata';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const SESSION_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const SESSION_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const TOM = '11111111-0000-4000-8000-000000000001';
const ZOE = '22222222-0000-4000-8000-000000000002';
const ANA = '33333333-0000-4000-8000-000000000003';
/** The roster row of the organiser who clicks: she has a seat in the session too. */
const CLAIRE = '44444444-0000-4000-8000-000000000004';
const NOT_BOOKED = '55555555-0000-4000-8000-000000000005';

const booking = (id: string, session: string, row: string, status: string, position = 0) => ({
  id,
  workshop_session_id: session,
  user_id: row,
  status,
  position: position || null,
});

/** The listed person sits in the MIDDLE: the first or the last row would pass a lazy filter. */
const BOOKINGS = {
  rows: [
    booking('e-claire', SESSION_A, CLAIRE, 'confirmed'),
    booking('e-tom-b', SESSION_B, TOM, 'confirmed'),
    booking('e-tom', SESSION_A, TOM, 'confirmed'),
    booking('e-ana', SESSION_A, ANA, 'refused'),
    booking('e-zoe', SESSION_A, ZOE, 'waitlisted', 1),
  ],
};

/** Two clubs, each with one Event, one Workshop and one session. */
const CLUBS = {
  workshop_sessions: {
    rows: [
      { id: SESSION_B, workshop_id: 'w-b', workshops: { capacity: 2 } },
      { id: SESSION_A, workshop_id: 'w-a', workshops: { capacity: 2 } },
    ],
  },
  workshops: {
    rows: [
      { id: 'w-b', event_id: 'event-b' },
      { id: 'w-a', event_id: 'event-a' },
    ],
  },
  events: {
    rows: [
      { id: 'event-b', organization_id: 'org-b' },
      { id: 'event-a', organization_id: 'org-a' },
    ],
  },
  organization_members: {
    rows: [
      { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      { organization_id: 'org-a', user_id: 'u-referee-a', role: 'referee' },
      { organization_id: 'org-a', user_id: 'u-lead-a', role: 'workshop_lead' },
    ],
  },
  // The instructor of the Workshop holds no club role. Accepting and refusing take him; this
  // route does not, so the bar it stands at reads neither table.
  global_persons: { rows: [{ id: 'gp-instructor', claimed_by_user_id: 'u-instructor' }] },
  workshop_instructors: {
    rows: [{ id: 'wi-1', workshop_id: 'w-a', global_person_id: 'gp-instructor' }],
  },
};

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopsController;
const alertAsked = vi.fn(async (_session: string, _row: string) => undefined);
const waitlistPromoted = vi.fn(async (_session: string, _row: string) => undefined);

function build(bookings: TableSeed = BOOKINGS) {
  db = mockSupabase({ ...CLUBS, workshop_enrollments: bookings });
  // The token IS the user id here; no token at all is the anonymous caller.
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
  const enrollment = new EnrollmentService(
    supabase as never,
    { waitlistPromoted } as never,
    { scheduleWorkshopSessionStarting: alertAsked } as never,
  );
  controller = new WorkshopsController(
    workshops,
    enrollment,
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => {
  alertAsked.mockReset();
  waitlistPromoted.mockReset();
  build();
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

const remove = (personId: string, userId?: string, session = SESSION_A) =>
  controller.removeBooking(session, personId, req(userId));

const bookingWrites = () =>
  writesTo(db, 'workshop_enrollments').map((write) => ({
    op: write.op,
    session: scopedTo(write, 'workshop_session_id'),
    person: scopedTo(write, 'user_id'),
    id: scopedTo(write, 'id'),
    row: write.row,
  }));

/** The one delete of a removal: scoped by session AND roster row, never by more or less. */
const deleteOf = (session: string, person: string) => ({
  op: 'delete',
  session,
  person,
  id: undefined,
  row: undefined,
});

describe('the organiser removes a listed person from a Workshop roster (ruling 214)', () => {
  it('is DELETE workshop-sessions/:id/enrollments/:personId, answered 204', () => {
    const handler = WorkshopsController.prototype.removeBooking;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'workshop-sessions/:id/enrollments/:personId',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.NO_CONTENT);
    // The session first, the person second: the tests below call the handler by position.
    const params = Object.values(
      Reflect.getMetadata(ROUTE_ARGS_METADATA, WorkshopsController, 'removeBooking') as Record<
        string,
        { index: number; data?: string }
      >,
    );
    expect(params.map((param) => [param.index, param.data])).toEqual(
      expect.arrayContaining([
        [0, 'id'],
        [1, 'personId'],
      ]),
    );
  });

  it('deletes the listed booking, and not the one of the organiser who clicked', async () => {
    await expect(remove(TOM, 'u-lead-a')).resolves.toBeUndefined();

    // Tom's seat in this session: not Claire's, and not his seat in the other session.
    expect(bookingWrites()[0]).toEqual(deleteOf(SESSION_A, TOM));
    expect(bookingWrites().filter((write) => write.op === 'delete')).toHaveLength(1);
    // The delete asks for the row it removed. PostgREST returns none unless asked (this double
    // answers either way), and with none the seat would go to nobody.
    expect(selectsFor(db.from, 'workshop_enrollments')[0]).toBe('id, status');
  });

  it("removes the seat's alert, then gives the seat to the first person waiting", async () => {
    await remove(TOM, 'u-lead-a');

    expect(bookingWrites()[1]).toMatchObject({
      op: 'update',
      id: 'e-zoe',
      row: { status: 'confirmed', position: null },
    });
    expect(alertAsked.mock.calls).toEqual([
      [SESSION_A, TOM],
      [SESSION_A, ZOE],
    ]);
    expect(waitlistPromoted.mock.calls).toEqual([[SESSION_A, ZOE]]);
  });

  it.each<[string, string]>([
    ['a person on the waitlist', ZOE],
    ['a person the instructor refused, who may then book again', ANA],
  ])('deletes the booking of %s, and promotes nobody', async (_who, personId) => {
    await remove(personId, 'u-lead-a');

    const [first, ...rest] = bookingWrites();
    expect(first).toEqual(deleteOf(SESSION_A, personId));
    // What follows only numbers the waitlist again (`enrollment.service.test.ts` holds it).
    expect(rest.filter((write) => !('position' in (write.row as object)))).toEqual([]);
    expect(rest.filter((write) => 'status' in (write.row as object))).toEqual([]);
    expect(alertAsked.mock.calls).toEqual([[SESSION_A, personId]]);
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });

  it('gives the seat to nobody when another cancel removed the booking first', async () => {
    // Claire's "Remove" and Tom's own cancel at the same moment: this delete finds no row.
    build([{ data: [], error: null }]);

    await expect(remove(TOM, 'u-lead-a')).resolves.toBeUndefined();

    expect(bookingWrites()).toEqual([deleteOf(SESSION_A, TOM)]);
    expect(alertAsked.mock.calls).toEqual([[SESSION_A, TOM]]);
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });

  it('goes by the booking as it was deleted: a seat refused a moment before frees nothing', async () => {
    // The roster Claire looks at says "confirmed". The instructor refused Tom since, and that
    // refusal already gave his seat away.
    build([{ data: [{ id: 'e-tom', status: 'refused' }], error: null }]);

    await remove(TOM, 'u-lead-a');

    expect(bookingWrites()).toEqual([deleteOf(SESSION_A, TOM)]);
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });

  it('answers the same for a person with no booking in the session, and gives no seat away', async () => {
    await expect(remove(NOT_BOOKED, 'u-lead-a')).resolves.toBeUndefined();

    expect(bookingWrites()).toEqual([deleteOf(SESSION_A, NOT_BOOKED)]);
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });
});

describe('who may remove a booking: the bar of the route that adds a person', () => {
  it('refuses a caller with no login with a 401, and touches no booking', async () => {
    await expect(remove(TOM)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(queriedTables(db.from)).not.toContain('workshop_enrollments');
    expect(alertAsked).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['a member of no club', 'u-stranger'],
    ["another club's owner", 'u-owner-b'],
    ['a member of the club below workshop_lead', 'u-referee-a'],
    ["the Workshop's instructor, who holds no club role", 'u-instructor'],
  ])('refuses %s (%s), and touches no booking', async (_why, caller) => {
    await expect(remove(TOM, caller)).rejects.toBeInstanceOf(ForbiddenException);

    expect(queriedTables(db.from)).not.toContain('workshop_enrollments');
    expect(alertAsked).not.toHaveBeenCalled();
  });

  it("checks the session's OWN Event, not one the caller belongs to", async () => {
    await expect(remove(TOM, 'u-lead-a', SESSION_B)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(remove(TOM, 'u-owner-b', SESSION_B)).resolves.toBeUndefined();

    expect(bookingWrites()[0]).toEqual(deleteOf(SESSION_B, TOM));
  });

  it('answers a session that does not exist with a 404, for the organiser too', async () => {
    const refusal = await remove(TOM, 'u-lead-a', UNKNOWN).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect((refusal as NotFoundException).message).toBe(`Session ${UNKNOWN} not found`);
    expect(queriedTables(db.from)).not.toContain('workshop_enrollments');
  });

  it('refuses each caller as the route that adds a person does', async () => {
    for (const caller of [undefined, 'u-stranger', 'u-owner-b', 'u-referee-a', 'u-instructor']) {
      const refused = async (call: Promise<unknown>) =>
        (await call.catch((error: unknown) => error)) as HttpException;
      const removing = await refused(remove(TOM, caller));
      const adding = await refused(controller.enrollPerson(SESSION_A, TOM, req(caller)));

      expect(removing.getResponse(), String(caller)).toEqual(adding.getResponse());
    }
  });
});

describe('a booking that cannot be deleted is a failure, not "removed"', () => {
  it('a delete that fails is a plain error: the seat is not free, so nobody is promoted', async () => {
    build([{ data: null, error: { message: 'connection reset' } }]);

    const refusal = await remove(TOM, 'u-lead-a').catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toBeInstanceOf(HttpException);
    expect((refusal as Error).message).toBe(
      `Booking of ${TOM} in session ${SESSION_A} not deleted: connection reset`,
    );
    expect(bookingWrites()).toEqual([deleteOf(SESSION_A, TOM)]);
    expect(alertAsked).not.toHaveBeenCalled();
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });
});
