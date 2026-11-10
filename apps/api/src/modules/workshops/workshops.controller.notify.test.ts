/**
 * A message to a Workshop's people (operator rulings 530-532).
 *
 * "Longsword basics" runs Saturday, Sunday and Monday; Saturday was cancelled and its people told.
 * The organiser writes from Sunday's roster: only Sunday's people get it (530). The instructor
 * writes to the whole Workshop: Sunday's and Monday's people get it, Saturday's do not (531). A
 * message to Saturday alone is refused (532).
 *
 * Driven through the controller and the real service over seeded tables, so the filters are
 * applied, not asked.
 */
import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodOrClassValidationPipe } from '../../common/zod-or-class-validation.pipe';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const WORKSHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER_WORKSHOP = 'bbbbbbbb-0000-4000-8000-00000000000b';
const SATURDAY = '11111111-0000-4000-8000-000000000001';
const SUNDAY = '22222222-0000-4000-8000-000000000002';
const MONDAY = '33333333-0000-4000-8000-000000000003';
const ELSEWHERE = '44444444-0000-4000-8000-000000000004';
const LEAD = 'u-lead';

const booking = (id: string, session: string, person: string, status: string) => ({
  id,
  workshop_session_id: session,
  user_id: person,
  status,
});

const BOOKINGS: TableSeed = {
  rows: [
    booking('e1', SATURDAY, 'p-sat', 'confirmed'),
    booking('e2', SUNDAY, 'p-sun', 'confirmed'),
    booking('e3', SUNDAY, 'p-sun-wait', 'waitlisted'),
    booking('e4', SUNDAY, 'p-sun-refused', 'refused'),
    booking('e5', SUNDAY, 'p-sun-intent', 'intent'),
    booking('e6', MONDAY, 'p-mon', 'confirmed'),
    // Booked twice, as a lapsed single-booking rule could leave her: told once.
    booking('e7', MONDAY, 'p-sun', 'waitlisted'),
    booking('e8', ELSEWHERE, 'p-other', 'confirmed'),
  ],
};

/** One club, one Event; the Workshop's Saturday is cancelled. */
const CLUB: Record<string, TableSeed> = {
  events: { rows: [{ id: 'event-a', organization_id: 'org-a' }] },
  workshops: {
    rows: [
      { id: WORKSHOP, event_id: 'event-a' },
      { id: OTHER_WORKSHOP, event_id: 'event-a' },
    ],
  },
  workshop_sessions: {
    rows: [
      { id: SATURDAY, workshop_id: WORKSHOP, status: 'cancelled' },
      { id: SUNDAY, workshop_id: WORKSHOP, status: 'scheduled' },
      { id: MONDAY, workshop_id: WORKSHOP, status: 'running' },
      { id: ELSEWHERE, workshop_id: OTHER_WORKSHOP, status: 'scheduled' },
    ],
  },
  organization_members: {
    rows: [
      { organization_id: 'org-a', user_id: LEAD, role: 'workshop_lead' },
      { organization_id: 'org-a', user_id: 'u-referee', role: 'referee' },
    ],
  },
  global_persons: { rows: [] },
  workshop_instructors: { rows: [] },
};

function build(bookings: TableSeed = BOOKINGS, over: Record<string, TableSeed> = {}) {
  const db = mockSupabase({ ...CLUB, workshop_enrollments: bookings, ...over });
  // The token IS the user id here.
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
  const sent = vi.fn(async (_event: string, _actor: string, people: string[]) => ({
    id: 'broadcast-1',
    recipientCount: people.length,
  }));
  const controller = new WorkshopsController(
    workshops,
    {} as never,
    supabase as never,
    { sendToEventPersons: sent } as never,
    {} as never,
    {} as never,
  );
  return { db, sent, controller };
}

const req = (userId: string) =>
  ({ headers: { authorization: `Bearer ${userId}` }, cookies: {} }) as never;

const MESSAGE = { title: 'Hall B', body: 'We moved to Hall B.' };

/** The people the one broadcast went to, sorted. */
const told = (sent: ReturnType<typeof build>['sent']) => {
  expect(sent).toHaveBeenCalledTimes(1);
  return [...(sent.mock.calls[0]?.[2] ?? [])].sort();
};

describe("a message from one session's roster (530)", () => {
  it("reaches that session's seats and waitlist, and no one else", async () => {
    const { controller, sent, db } = build();
    const result = await controller.notifyEnrollees(
      WORKSHOP,
      { ...MESSAGE, sessionId: SUNDAY },
      req(LEAD),
    );
    expect(told(sent)).toEqual(['p-sun', 'p-sun-wait']);
    expect(sent.mock.calls[0]?.slice(0, 2)).toEqual(['event-a', LEAD]);
    expect(result).toEqual({ id: 'broadcast-1', recipientCount: 2 });
    // The double ignores the projection: only this holds the columns each read uses.
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual(['workshop_id, status']);
    // Paged by id: a second read finds the page after the last one empty.
    expect(new Set(selectsFor(db.from, 'workshop_enrollments'))).toEqual(new Set(['id, user_id']));
  });

  it('tells every one of more people than one read returns', async () => {
    const many = Array.from({ length: 1205 }, (_, i) => {
      const n = String(i).padStart(4, '0');
      return booking(`e-${n}`, SUNDAY, `p-${n}`, 'confirmed');
    });
    const { controller, sent } = build({ rows: many });
    await controller.notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: SUNDAY }, req(LEAD));
    expect(told(sent)).toHaveLength(1205);
  });

  it('refuses a session of another Workshop, telling nobody', async () => {
    const { controller, sent } = build();
    await expect(
      controller.notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: ELSEWHERE }, req(LEAD)),
    ).rejects.toThrow(NotFoundException);
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses a session that does not exist, telling nobody', async () => {
    const { controller, sent } = build();
    const unknown = '99999999-0000-4000-8000-000000000009';
    await expect(
      controller.notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: unknown }, req(LEAD)),
    ).rejects.toThrow(NotFoundException);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('a cancelled session tells nobody (531, 532)', () => {
  it('refuses a message to the cancelled session itself, by name', async () => {
    const { controller, sent } = build();
    const refusal = await controller
      .notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: SATURDAY }, req(LEAD))
      .catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      error: 'WorkshopSessionCancelled',
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("leaves the cancelled session's people out of a message to the whole Workshop", async () => {
    const { controller, sent, db } = build();
    await controller.notifyEnrollees(WORKSHOP, MESSAGE, req(LEAD));
    expect(told(sent)).toEqual(['p-mon', 'p-sun', 'p-sun-wait']);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual(['id']);
  });

  it('sends nothing when every session is cancelled', async () => {
    const { controller, sent } = build({ rows: [booking('e1', SATURDAY, 'p-sat', 'confirmed')] });
    await expect(controller.notifyEnrollees(WORKSHOP, MESSAGE, req(LEAD))).resolves.toEqual({
      id: null,
      recipientCount: 0,
    });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('the door', () => {
  it('fails, rather than reporting 0 people, when the sessions cannot be read', async () => {
    const { controller, sent } = build(BOOKINGS, {
      workshop_sessions: { data: null, error: { message: 'sessions down' } },
    });
    await expect(controller.notifyEnrollees(WORKSHOP, MESSAGE, req(LEAD))).rejects.toThrow(
      'sessions down',
    );
    expect(sent).not.toHaveBeenCalled();
  });

  it('fails, rather than reporting 0 people, when the bookings cannot be read', async () => {
    const { controller, sent } = build({ data: null, error: { message: 'boom' } });
    await expect(
      controller.notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: SUNDAY }, req(LEAD)),
    ).rejects.toThrow('boom');
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses a club member below workshop lead before reading anyone', async () => {
    const { controller, sent, db } = build();
    await expect(
      controller.notifyEnrollees(WORKSHOP, { ...MESSAGE, sessionId: SUNDAY }, req('u-referee')),
    ).rejects.toThrow(ForbiddenException);
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual([]);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('POST workshops/:id/notify body', () => {
  const pipe = new ZodOrClassValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const paramTypes = Reflect.getMetadata(
    'design:paramtypes',
    WorkshopsController.prototype,
    'notifyEnrollees',
  ) as unknown[];
  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: paramTypes[1] as ArgumentMetadata['metatype'],
    data: '',
  };

  it('takes a session, or none', async () => {
    await expect(pipe.transform({ ...MESSAGE, sessionId: SUNDAY }, meta)).resolves.toEqual({
      ...MESSAGE,
      sessionId: SUNDAY,
    });
    await expect(pipe.transform(MESSAGE, meta)).resolves.toEqual(MESSAGE);
  });

  it('refuses a session that is not an id', async () => {
    await expect(pipe.transform({ ...MESSAGE, sessionId: 'sunday' }, meta)).rejects.toThrow(
      BadRequestException,
    );
  });
});
