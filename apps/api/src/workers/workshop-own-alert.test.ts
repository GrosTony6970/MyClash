/**
 * The own Workshop "starting soon" alert reaches the ACCOUNT that holds a booking (operator ruling
 * 210), and follows the booking as saved.
 *
 * It reached nobody. A booking names a roster row (`workshop_enrollments.user_id` holds a
 * `persons.id`), and the alert was addressed to that id as if it were an account. It was also set
 * only when an organiser created or edited the session, and people book after that.
 *
 * Léa has an account and a confirmed seat. Tom booked as a guest: no account, so he is told
 * nothing. Zoé is on the waitlist, and Ana was refused by the instructor.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../common/testing/supabase-chain';
import { NotificationSchedulerService } from './notification-scheduler.worker';

const NOW = new Date('2026-05-02T10:00:00.000Z');
const at = (hhmm: string) => `2026-05-02T${hhmm}:00.000Z`;
const MIN = 60_000;

const session = (id: string, startsAt: string | null, status = 'scheduled') => ({
  id,
  starts_at: startsAt,
  status,
  workshops: { title: 'Longsword' },
});
const booking = (sessionId: string, row: string, status: string) => ({
  workshop_session_id: sessionId,
  user_id: row,
  status,
});
const rosterRow = (id: string, account: string | null) => ({ id, claimed_by_user_id: account });

function tables(): Record<string, TableSeed> {
  return {
    workshop_sessions: {
      rows: [
        session('s-1', at('14:00')),
        session('s-other', at('15:00')),
        session('s-cancelled', at('14:00'), 'cancelled'),
        session('s-started', at('09:30')),
        session('s-now', at('10:00')),
        session('s-untimed', null),
      ],
    },
    workshop_enrollments: {
      rows: [
        booking('s-1', 'lea-row', 'confirmed'),
        booking('s-1', 'tom-row', 'confirmed'),
        booking('s-1', 'zoe-row', 'waitlisted'),
        booking('s-1', 'ana-row', 'refused'),
        // Paul's seat is in another session.
        booking('s-other', 'paul-row', 'confirmed'),
        ...['s-cancelled', 's-started', 's-now', 's-untimed'].map((id) =>
          booking(id, 'lea-row', 'confirmed'),
        ),
      ],
    },
    persons: {
      rows: [
        rosterRow('lea-row', 'u-lea'),
        rosterRow('tom-row', null),
        rosterRow('zoe-row', 'u-zoe'),
        rosterRow('ana-row', 'u-ana'),
        rosterRow('paul-row', 'u-paul'),
        rosterRow('max-row', 'u-max'),
      ],
    },
    notification_preferences: { rows: [] },
  };
}

function setup(overrides: Record<string, TableSeed> = {}) {
  const removed: string[] = [];
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn(async (id: string) => ({ remove: async () => void removed.push(id) })),
  };
  const db = mockSupabase({ ...tables(), ...overrides });
  const service = new NotificationSchedulerService(queue as never, db as never);
  const set = () => queue.add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId).sort();
  return { service, queue, db, removed, set };
}

const alertOf = (sessionId: string, account: string) =>
  `notification.workshop_starting.${sessionId}.${account}`;
const BOOM = { data: null, error: { message: 'boom' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('who the own Workshop alert reaches (ruling 210)', () => {
  it('the account of a confirmed seat, and nobody else of the session', async () => {
    const { service, queue, removed, set } = setup();

    await service.scheduleWorkshopSessionStarting('s-1', undefined, NOW);

    // Not Tom (a guest: no account), not Zoé (waitlisted), not Ana (refused), not Paul (another
    // session). And never the roster row's id: that addressed nobody.
    expect(set()).toEqual([alertOf('s-1', 'u-lea')]);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'workshop_starting',
        entityId: 's-1',
        userId: 'u-lea',
        title: 'Atelier imminent / Workshop starting soon',
        body: 'Longsword commence bientôt. / Longsword starts soon.',
      }),
      // 14:00, 15 minutes before by default, asked at 10:00.
      expect.objectContaining({ delay: 225 * MIN }),
    );
    // A seat that is no longer confirmed loses the alert it had.
    expect(removed.sort()).toEqual(['u-ana', 'u-lea', 'u-zoe'].map((u) => alertOf('s-1', u)));
  });

  it('reads the session, its bookings and their roster rows by columns the tables have', async () => {
    const { service, db } = setup();

    await service.scheduleWorkshopSessionStarting('s-1', undefined, NOW);

    expect(selectsFor(db.from, 'workshop_sessions')).toEqual([
      'id, starts_at, status, workshops ( title )',
    ]);
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual(['user_id, status']);
    expect(selectsFor(db.from, 'persons')).toEqual(['id, claimed_by_user_id']);
  });

  it('rings at the lead each account chose', async () => {
    const lead = (account: string, minutes: string) => ({
      user_id: account,
      enabled: true,
      workshop_starting_minutes_before: minutes,
    });
    const { service, queue } = setup({
      workshop_enrollments: {
        rows: [booking('s-1', 'lea-row', 'confirmed'), booking('s-1', 'paul-row', 'confirmed')],
      },
      notification_preferences: { rows: [lead('u-lea', '20'), lead('u-paul', '5')] },
    });

    await service.scheduleWorkshopSessionStarting('s-1', undefined, NOW);

    const delays = queue.add.mock.calls.map((call) => [call[1].userId, call[2].delay]);
    expect(delays).toEqual([
      ['u-lea', 220 * MIN],
      ['u-paul', 235 * MIN],
    ]);
  });

  it('rings at once for a seat confirmed inside the lead time', async () => {
    const { service, queue } = setup({
      workshop_sessions: { rows: [session('s-1', at('10:05'))] },
    });

    await service.scheduleWorkshopSessionStarting('s-1', 'lea-row', NOW);

    expect(queue.add.mock.calls[0]?.[2]).toMatchObject({ delay: 0 });
  });

  it('sets nothing for an account whose main switch is off, and removes the alert it had', async () => {
    const { service, removed, set } = setup({
      notification_preferences: { rows: [{ user_id: 'u-lea', enabled: false }] },
    });

    await service.scheduleWorkshopSessionStarting('s-1', 'lea-row', NOW);

    expect(set()).toEqual([]);
    expect(removed).toEqual([alertOf('s-1', 'u-lea')]);
  });
});

describe('the alert follows one booking as saved', () => {
  it('a seat confirmed after the session was planned gets its alert, and nobody else is touched', async () => {
    const { service, db, removed, set } = setup();

    await service.scheduleWorkshopSessionStarting('s-other', 'paul-row', NOW);

    expect(set()).toEqual([alertOf('s-other', 'u-paul')]);
    expect(removed).toEqual([alertOf('s-other', 'u-paul')]);
    // His booking alone is read, not every booking of the session.
    expect(filtersFor(db.from, 'workshop_enrollments', 'eq')).toEqual([
      ['workshop_session_id', 's-other'],
      ['user_id', 'paul-row'],
    ]);
  });

  it.each([
    ['a booking moved to the waitlist', 'zoe-row', 'u-zoe'],
    ['a refused booking', 'ana-row', 'u-ana'],
    ['a cancelled booking, whose row is gone', 'max-row', 'u-max'],
  ])('%s loses its alert', async (_, row, account) => {
    const { service, removed, set } = setup();

    await service.scheduleWorkshopSessionStarting('s-1', row, NOW);

    expect(set()).toEqual([]);
    expect(removed).toEqual([alertOf('s-1', account)]);
  });

  it('a guest booking has no account to tell', async () => {
    const { service, queue } = setup();

    await service.scheduleWorkshopSessionStarting('s-1', 'tom-row', NOW);

    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('an empty roster id is nobody, not everybody', async () => {
    const { service, queue } = setup();

    await service.scheduleWorkshopSessionStarting('s-1', '', NOW);

    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('a session that cannot ring', () => {
  it.each([
    ['cancelled', 's-cancelled'],
    ['already started', 's-started'],
    ['starting this very minute', 's-now'],
    ['with no time', 's-untimed'],
  ])('%s: the confirmed seat loses its alert, and gets no new one', async (_, sessionId) => {
    const { service, removed, set } = setup();

    await service.scheduleWorkshopSessionStarting(sessionId, undefined, NOW);

    expect(set()).toEqual([]);
    expect(removed).toEqual([alertOf(sessionId, 'u-lea')]);
  });

  it('a session that is gone sets and removes nothing', async () => {
    const { service, queue } = setup();

    await service.scheduleWorkshopSessionStarting('s-gone', undefined, NOW);

    expect(queue.getJob).not.toHaveBeenCalled();
  });
});

describe('a read that fails is logged, and the alerts stay as they were', () => {
  const READS: Array<[string, string]> = [
    ['workshop_sessions', 'Workshop session s-1 unreadable'],
    ['workshop_enrollments', 'Bookings of Workshop session s-1 unreadable'],
    ['persons', 'Roster rows of the bookings of Workshop session s-1 unreadable'],
  ];
  const DOORS: Array<[string, string | undefined]> = [
    ['an organiser saved the session', undefined],
    ['her booking changed', 'lea-row'],
  ];
  const CASES = DOORS.flatMap(([door, row]) =>
    READS.map(([table, said]): [string, string, string, string | undefined] => [
      door,
      table,
      said,
      row,
    ]),
  );

  it.each(CASES)('%s, %s unreadable: nothing is set or removed', async (_, table, said, row) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, queue } = setup({ [table]: BOOM });

    await service.scheduleWorkshopSessionStarting('s-1', row, NOW);

    // Not "no booking": that would remove the alert of her confirmed seat.
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `${said}; its alerts stay as they were: boom`,
    ]);
  });
});
