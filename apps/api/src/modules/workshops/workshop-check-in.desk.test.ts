/**
 * The front desk ticks a Workshop's people on the day they arrive (operator rulings 540, 543-547).
 *
 * Léa is booked in several sessions of a 2-day Event (Paris clock). The desk marks her arrived:
 * the sessions of THAT day, of Workshops whose switch is on, that still run and that nobody tapped,
 * get a tick carrying the arrival time. An undo removes the desk's ticks of the day it is pressed,
 * whatever happened to the switch or the session since; a tap is never touched.
 *
 * Over seeded bookings. The double ignores projections and does not apply writes: each read's
 * SELECT and each write's filters are asserted, and a story's later step seeds the state the
 * earlier one left.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { CheckinService } from '../checkin/checkin.service';
import { tickFromDesk, untickFromDesk } from './workshop-check-in';

const EVENT = 'event-1';
const PARIS = { timezone: 'Europe/Paris' };
const LEA = 'p-lea';
/** Saturday 09:12 in Paris. */
const SATURDAY_ARRIVAL = '2026-11-14T08:12:00Z';
/** Sunday 09:05 in Paris. */
const SUNDAY_ARRIVAL = '2026-11-15T08:05:00Z';

interface Seat {
  id: string;
  status?: string;
  startsAt?: string | null;
  sessionStatus?: string;
  auto?: boolean;
  event?: string;
  source?: 'desk' | 'hand' | null;
  checkedInAt?: string | null;
  timezone?: string | null;
}

/** A booking of Léa's as the desk reads it: the session, its Workshop and the Event clock. */
const booking = (seat: Seat) => ({
  id: seat.id,
  user_id: LEA,
  status: seat.status ?? 'confirmed',
  check_in_source: seat.source ?? null,
  checked_in_at: seat.checkedInAt ?? null,
  workshop_sessions: {
    starts_at: seat.startsAt === undefined ? '2026-11-14T09:00:00Z' : seat.startsAt,
    status: seat.sessionStatus ?? 'scheduled',
    workshops: {
      event_id: seat.event ?? EVENT,
      auto_check_in: seat.auto ?? true,
      events: seat.timezone === undefined ? PARIS : { timezone: seat.timezone },
    },
  },
});

const SATURDAY = '2026-11-14T09:00:00Z';
const SUNDAY = '2026-11-15T13:00:00Z';

function deskWith(seats: Seat[]) {
  const db = mockSupabase({ workshop_enrollments: { rows: seats.map(booking) } });
  return { db, warn: vi.fn() };
}

/** The one write, with what it names. */
function onlyWrite(db: ReturnType<typeof mockSupabase>) {
  const writes = writesTo(db, 'workshop_enrollments');
  expect(writes).toHaveLength(1);
  const [write] = writes;
  const filter = (method: string, column: string) =>
    write!.filters.find((f) => f.method === method && f.args[0] === column)?.args[1];
  return { row: write!.row, ids: filter('in', 'id'), filter };
}

describe('the desk marks Léa arrived (540, 543, 544)', () => {
  const SEATS: Seat[] = [
    { id: 'b-sat', startsAt: SATURDAY },
    { id: 'b-sun', startsAt: SUNDAY },
    { id: 'b-off', startsAt: SATURDAY, auto: false },
    { id: 'b-cancelled', startsAt: SATURDAY, sessionStatus: 'cancelled' },
    { id: 'b-no-start', startsAt: null },
    { id: 'b-other-event', startsAt: SATURDAY, event: 'event-2' },
    { id: 'b-waiting', startsAt: SATURDAY, status: 'waitlisted' },
  ];

  it("ticks Saturday's running sessions of switched-on Workshops, with the arrival time", async () => {
    const { db, warn } = deskWith(SEATS);
    await tickFromDesk(db.service as never, EVENT, LEA, SATURDAY_ARRIVAL, warn);

    const { row, ids, filter } = onlyWrite(db);
    expect(ids).toEqual(['b-sat', 'b-waiting']);
    expect(row).toEqual({ checked_in_at: SATURDAY_ARRIVAL, check_in_source: 'desk' });
    // Named again on the write: a tap or a refusal landing after the read keeps its booking out.
    expect(filter('is', 'check_in_source')).toBeNull();
    expect(filter('in', 'status')).toEqual(['confirmed', 'waitlisted']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads the session, its Workshop switch and the Event clock, of untapped live bookings', async () => {
    const { db, warn } = deskWith(SEATS);
    await tickFromDesk(db.service as never, EVENT, LEA, SATURDAY_ARRIVAL, warn);

    expect(selectsFor(db.from, 'workshop_enrollments')[0]).toBe(
      'id, checked_in_at, workshop_sessions ( starts_at, status, workshops ( event_id, auto_check_in, events ( timezone ) ) )',
    );
  });

  it('reads the day on the Event clock: 00:30 Sunday in Paris is Sunday, though 23:30 UTC', async () => {
    const { db, warn } = deskWith(SEATS);
    await tickFromDesk(db.service as never, EVENT, LEA, '2026-11-14T23:30:00Z', warn);

    expect(onlyWrite(db).ids).toEqual(['b-sun']);
  });

  it("on Sunday ticks Sunday's session and leaves Saturday's desk tick alone (546, 547)", async () => {
    // Saturday's arrival already ticked Saturday's session.
    const { db, warn } = deskWith([
      { id: 'b-sat', startsAt: SATURDAY, source: 'desk', checkedInAt: SATURDAY_ARRIVAL },
      { id: 'b-sun', startsAt: SUNDAY },
    ]);
    await tickFromDesk(db.service as never, EVENT, LEA, SUNDAY_ARRIVAL, warn);

    expect(onlyWrite(db).ids).toEqual(['b-sun']);
  });

  it('never ticks over a tap, ticked or cleared (545), nor a refused person (541)', async () => {
    const { db, warn } = deskWith([
      { id: 'b-tapped', startsAt: SATURDAY, source: 'hand', checkedInAt: null },
      { id: 'b-refused', startsAt: SATURDAY, status: 'refused' },
    ]);
    await tickFromDesk(db.service as never, EVENT, LEA, SATURDAY_ARRIVAL, warn);

    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
  });

  it('says an unknown Event zone once per arrival, and reads the day on the default clock', async () => {
    const { db, warn } = deskWith([
      { id: 'b-sat', startsAt: SATURDAY, timezone: 'Mars/Olympus' },
      { id: 'b-sat-2', startsAt: SATURDAY, timezone: 'Mars/Olympus' },
    ]);
    await tickFromDesk(db.service as never, EVENT, LEA, SATURDAY_ARRIVAL, warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown time zone "Mars/Olympus"'));
    expect(onlyWrite(db).ids).toEqual(['b-sat', 'b-sat-2']);
  });

  it('throws when the bookings cannot be read: never read as "nothing to tick"', async () => {
    const db = mockSupabase({ workshop_enrollments: { data: null, error: { message: 'down' } } });
    await expect(
      tickFromDesk(db.service as never, EVENT, LEA, SATURDAY_ARRIVAL, vi.fn()),
    ).rejects.toThrow(/were not read: down/);
  });
});

describe('the desk undoes the arrival (545, 547)', () => {
  const NOW_SATURDAY = '2026-11-14T09:30:00Z';

  it("removes the desk's ticks of the day, even after the switch went off or the session was cancelled", async () => {
    const { db, warn } = deskWith([
      { id: 'd-sat', source: 'desk', checkedInAt: SATURDAY_ARRIVAL },
      { id: 'd-switched-off', source: 'desk', checkedInAt: SATURDAY_ARRIVAL, auto: false },
      {
        id: 'd-cancelled',
        source: 'desk',
        checkedInAt: SATURDAY_ARRIVAL,
        sessionStatus: 'cancelled',
      },
      // Ticked on Saturday, then its session was moved to Sunday: still Saturday's tick.
      { id: 'd-moved', source: 'desk', checkedInAt: SATURDAY_ARRIVAL, startsAt: SUNDAY },
      { id: 'd-sunday', source: 'desk', checkedInAt: SUNDAY_ARRIVAL },
      { id: 'd-other-event', source: 'desk', checkedInAt: SATURDAY_ARRIVAL, event: 'event-2' },
    ]);
    await untickFromDesk(db.service as never, EVENT, LEA, NOW_SATURDAY, warn);

    const { row, ids, filter } = onlyWrite(db);
    expect(ids).toEqual(['d-sat', 'd-switched-off', 'd-cancelled', 'd-moved']);
    expect(row).toEqual({ checked_in_at: null, check_in_source: null });
    expect(filter('eq', 'check_in_source')).toBe('desk');
    expect(selectsFor(db.from, 'workshop_enrollments')[0]).toBe(
      'id, checked_in_at, workshop_sessions ( workshops ( event_id, events ( timezone ) ) )',
    );
  });

  it("on Sunday leaves Saturday's ticks: an undo is about the day it is pressed", async () => {
    const { db, warn } = deskWith([{ id: 'd-sat', source: 'desk', checkedInAt: SATURDAY_ARRIVAL }]);
    await untickFromDesk(db.service as never, EVENT, LEA, SUNDAY_ARRIVAL, warn);

    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
  });

  it('never touches a tap: the read asks for desk ticks only', async () => {
    const { db, warn } = deskWith([{ id: 'h-sat', source: 'hand', checkedInAt: SATURDAY_ARRIVAL }]);
    await untickFromDesk(db.service as never, EVENT, LEA, NOW_SATURDAY, warn);

    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
  });
});

describe('at the desk itself', () => {
  const REQ = {} as FastifyRequest;
  const staff = {
    requireStaffWithRole: vi.fn(async () => ({ id: 'staff-1', event_id: EVENT, role: 'checkin' })),
  };

  it('keeps the arrival when the Workshop ticks fail, and says so in the log', async () => {
    const arrival = {
      person_id: LEA,
      state: 'present',
      via: 'search',
      marked_at: SATURDAY_ARRIVAL,
    };
    const db = mockSupabase({
      persons: { rows: [{ id: LEA, event_id: EVENT }] },
      event_arrivals: { data: arrival, error: null },
      workshop_enrollments: { data: null, error: { message: 'connection reset' } },
    });
    const service = new CheckinService(db as never, staff as never, {} as never);
    const logged = vi.spyOn(
      (service as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    );

    await expect(service.markArrived(REQ, LEA, { via: 'search' })).resolves.toEqual(arrival);
    expect(logged).toHaveBeenCalledWith(
      `Event ${EVENT}: the Workshop ticks of ${LEA} were not written: The bookings of ${LEA} were not read: connection reset`,
    );
  });

  it("ticks the day's sessions when the desk marks the person, before it answers", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(SATURDAY_ARRIVAL));
    try {
      const db = mockSupabase({
        persons: { rows: [{ id: LEA, event_id: EVENT }] },
        event_arrivals: { data: { person_id: LEA, state: 'present' }, error: null },
        workshop_enrollments: { rows: [booking({ id: 'b-sat', startsAt: SATURDAY })] },
      });
      const service = new CheckinService(db as never, staff as never, {} as never);

      await service.markArrived(REQ, LEA, { via: 'search' });

      expect(writesTo(db, 'workshop_enrollments').map((write) => write.row)).toEqual([
        { checked_in_at: '2026-11-14T08:12:00.000Z', check_in_source: 'desk' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the day's desk ticks when the desk undoes an arrival it holds", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T08:20:00Z'));
    try {
      const db = mockSupabase({
        event_arrivals: { data: { person_id: LEA, state: 'absent' }, error: null },
        workshop_enrollments: {
          rows: [booking({ id: 'd-sat', source: 'desk', checkedInAt: SATURDAY_ARRIVAL })],
        },
      });
      const service = new CheckinService(db as never, staff as never, {} as never);

      await service.undoArrival(REQ, LEA);

      expect(writesTo(db, 'workshop_enrollments').map((write) => write.row)).toEqual([
        { checked_in_at: null, check_in_source: null },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes nothing when the desk held no arrival to undo', async () => {
    const db = mockSupabase({
      event_arrivals: { data: null, error: null },
      workshop_enrollments: {
        rows: [booking({ id: 'd-sat', source: 'desk', checkedInAt: SATURDAY_ARRIVAL })],
      },
    });
    const service = new CheckinService(db as never, staff as never, {} as never);

    await service.undoArrival(REQ, LEA);

    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
  });
});
