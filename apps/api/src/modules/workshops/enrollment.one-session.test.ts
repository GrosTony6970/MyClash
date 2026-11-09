/**
 * One person, one session per Workshop (operator rulings 515, 520-523).
 *
 * "Longsword basics" runs Saturday and Sunday. Alice holds Saturday: Sunday refuses her, and says
 * why (520). A place on Saturday's waitlist counts the same (521). A refusal on Saturday is a
 * removal from that session only: she may book Sunday (522). The organiser's add follows the same
 * rule (523), and so does an instructor taking a refusal back.
 *
 * Driven through the real service over simulated tables, so the rule's filters are applied, not
 * only asked: the refusal on Saturday that lets Alice book Sunday holds the status filter, and Bob's
 * seat on Saturday that does not stop her holds the person filter.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SATURDAY = 's-saturday';
const SUNDAY = 's-sunday';
const OTHER_WORKSHOP_SESSION = 's-sabre';
const ALICE = 'alice-row';
const BOB = 'bob-row';

const session = (id: string, workshopId = 'w-longsword', status = 'scheduled') => ({
  id,
  status,
  workshop_id: workshopId,
  workshops: { capacity: 12, status: 'published' },
});
const booking = (sessionId: string, personId: string, status: string) => ({
  id: `${sessionId}-${personId}`,
  workshop_session_id: sessionId,
  user_id: personId,
  status,
  position: status === 'waitlisted' ? 1 : null,
});

function build(bookings: Record<string, unknown>[], saturdayStatus = 'scheduled') {
  const supabase = mockSupabase({
    workshop_sessions: {
      rows: [
        session(SATURDAY, 'w-longsword', saturdayStatus),
        session(SUNDAY),
        session(OTHER_WORKSHOP_SESSION, 'w-sabre'),
      ],
    },
    // Nobody here teaches, and no profile flag is written.
    persons: {
      rows: [
        { id: ALICE, global_person_id: null },
        { id: BOB, global_person_id: null },
      ],
    },
    workshop_enrollments: { rows: bookings, returning: { id: 'e-new' } },
  });
  const service = new EnrollmentService(
    supabase as never,
    { waitlistPromoted: vi.fn() } as never,
    { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, supabase, writes: () => writesTo(supabase, 'workshop_enrollments') };
}

async function refusedAsBooked(action: Promise<unknown>) {
  const refusal = await action.catch((err: unknown) => err);
  expect(refusal).toBeInstanceOf(HttpException);
  expect((refusal as HttpException).getStatus()).toBe(409);
  // The exception filter sends `error` as the code WORKSHOP_ALREADY_BOOKED.
  expect((refusal as HttpException).getResponse()).toMatchObject({
    error: 'WorkshopAlreadyBooked',
  });
}

describe('one session per Workshop (rulings 520-523)', () => {
  it('refuses Sunday to Alice, who holds a seat on Saturday, and writes nothing (520)', async () => {
    const { service, writes } = build([booking(SATURDAY, ALICE, 'confirmed')]);
    await refusedAsBooked(service.enrollOwn(SUNDAY, ALICE));
    expect(writes()).toEqual([]);
  });

  it('refuses Sunday while she waits on Saturday: a waitlist place counts (521)', async () => {
    const { service, writes } = build([booking(SATURDAY, ALICE, 'waitlisted')]);
    await refusedAsBooked(service.enrollOwn(SUNDAY, ALICE));
    expect(writes()).toEqual([]);
  });

  it('books Sunday after a refusal on Saturday: a refusal is per session (522)', async () => {
    const { service, writes } = build([booking(SATURDAY, ALICE, 'refused')]);
    await expect(service.enrollOwn(SUNDAY, ALICE)).resolves.toMatchObject({
      sessionId: SUNDAY,
      status: 'confirmed',
    });
    expect(writes().map((write) => write.op)).toEqual(['insert']);
  });

  it('books Sunday when Saturday, where she holds a seat, was cancelled', async () => {
    // Her Saturday seat stays, but the pages hide a cancelled session: she could not give it up.
    const { service } = build([booking(SATURDAY, ALICE, 'confirmed')], 'cancelled');
    await expect(service.enrollOwn(SUNDAY, ALICE)).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('books Sunday whatever somebody else holds on Saturday', async () => {
    const { service } = build([booking(SATURDAY, BOB, 'confirmed')]);
    await expect(service.enrollOwn(SUNDAY, ALICE)).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('books a session of another Workshop', async () => {
    const { service } = build([booking(SATURDAY, ALICE, 'confirmed')]);
    await expect(service.enrollOwn(OTHER_WORKSHOP_SESSION, ALICE)).resolves.toMatchObject({
      status: 'confirmed',
    });
  });

  it('answers a second tap on her own session as it always did, refusing nothing', async () => {
    const { service, writes } = build([booking(SATURDAY, ALICE, 'confirmed')]);
    await expect(service.enrollOwn(SATURDAY, ALICE)).resolves.toMatchObject({
      sessionId: SATURDAY,
      status: 'confirmed',
    });
    expect(writes()).toEqual([]);
  });

  it("refuses the organiser's add of Alice to Sunday the same way (523)", async () => {
    const { service, writes } = build([booking(SATURDAY, ALICE, 'confirmed')]);
    await refusedAsBooked(service.enroll(SUNDAY, ALICE));
    expect(writes()).toEqual([]);
  });

  it('keeps her refusal on Sunday when "Register again" is refused', async () => {
    const { service, writes } = build([
      booking(SATURDAY, ALICE, 'confirmed'),
      booking(SUNDAY, ALICE, 'refused'),
    ]);
    await refusedAsBooked(service.enrollOwn(SUNDAY, ALICE, true));
    expect(writes()).toEqual([]);
  });

  it('refuses an instructor taking back her refusal on Sunday while she holds Saturday', async () => {
    const { service, writes } = build([
      booking(SATURDAY, ALICE, 'confirmed'),
      booking(SUNDAY, ALICE, 'refused'),
    ]);
    await refusedAsBooked(service.accept(SUNDAY, ALICE));
    expect(writes()).toEqual([]);
  });

  it('lets an instructor take a refusal back when she holds nothing else', async () => {
    const { service, writes } = build([booking(SUNDAY, ALICE, 'refused')]);
    await service.accept(SUNDAY, ALICE);
    expect(writes().map((write) => [write.op, write.row])).toEqual([
      ['update', { status: 'confirmed', position: null }],
    ]);
  });

  it("reads the Workshop's sessions, then the person's places in the others", async () => {
    const { service, supabase } = build([]);
    await service.enrollOwn(SUNDAY, ALICE);
    // The double ignores the projection: only this holds the columns the rule reads.
    expect(selectsFor(supabase.from, 'workshop_sessions')).toEqual([
      'status, workshop_id, workshops ( capacity, status )',
      'id',
    ]);
    expect(selectsFor(supabase.from, 'workshop_enrollments')[0]).toBe('workshop_session_id');
  });
});
