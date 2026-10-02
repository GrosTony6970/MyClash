/**
 * A booking's own "starting soon" alert is brought in line each time the booking changes (operator
 * ruling 210).
 *
 * The alert was set only when an organiser created or edited the session. People book after that,
 * so nobody who booked was ever told. Now a confirmed seat, a promotion from the waitlist, a
 * cancellation and a refusal each ask the scheduler for that booking's alert, after their write.
 * The step is best effort: a booking that is saved stands, and what follows it still runs.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const NONE = { data: null, error: null };
const OK = { data: null, error: null };
const row = (data: unknown) => ({ data, error: null });
const count = (n: number) => ({ data: null, error: null, count: n });

/** `bookings` is a canned queue: what each read or write of the bookings answers, in call order. */
function build(bookings: TableSeed, capacity: number | null = null) {
  const supabase = mockSupabase({
    workshop_sessions: row({ workshop_id: 'w-1', workshops: { capacity } }),
    // Nobody here teaches the Workshop, and no profile flag is written.
    persons: row({ global_person_id: null }),
    workshop_enrollments: bookings,
  });
  // How many writes the bookings had when the alert was asked for: the alert comes after the write.
  const writesWhenAsked: number[] = [];
  const scheduleWorkshopSessionStarting = vi.fn(async (_session: string, _row: string) => {
    writesWhenAsked.push(writesTo(supabase, 'workshop_enrollments').length);
  });
  const waitlistPromoted = vi.fn().mockResolvedValue(undefined);
  const service = new EnrollmentService(
    supabase as never,
    { waitlistPromoted } as never,
    { scheduleWorkshopSessionStarting } as never,
  );
  const asked = scheduleWorkshopSessionStarting;
  return { service, supabase, asked, writesWhenAsked, waitlistPromoted };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a booking's alert follows the booking (ruling 210)", () => {
  it('a confirmed seat asks for its alert, once it is saved', async () => {
    const { service, asked, writesWhenAsked } = build([NONE, row({ id: 'e-1' })]);

    await service.enroll(SESSION, 'lea-row');

    expect(asked.mock.calls).toEqual([[SESSION, 'lea-row']]);
    expect(writesWhenAsked).toEqual([1]);
  });

  it('a waitlisted booking asks too: the scheduler sets none for it', async () => {
    const { service, asked, writesWhenAsked } = build(
      [NONE, count(1), count(0), row({ id: 'e-2' })],
      1,
    );

    await expect(service.enroll(SESSION, 'zoe-row')).resolves.toMatchObject({
      status: 'waitlisted',
    });
    expect(asked.mock.calls).toEqual([[SESSION, 'zoe-row']]);
    expect(writesWhenAsked).toEqual([1]);
  });

  it('a booking that already exists asks again: the second tap repairs a lost alert', async () => {
    const { service, asked } = build(row({ id: 'e-1', status: 'confirmed', position: null }));

    await service.enroll(SESSION, 'lea-row');

    expect(asked.mock.calls).toEqual([[SESSION, 'lea-row']]);
  });

  it('an alert that cannot be set is logged, and the booking stands', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, asked } = build([NONE, row({ id: 'e-1' })]);
    asked.mockRejectedValueOnce(new Error('queue down'));

    await expect(service.enroll(SESSION, 'lea-row')).resolves.toMatchObject({
      status: 'confirmed',
    });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      'Workshop alert of booking lea-row in session s-1 not brought in line: queue down',
    ]);
  });

  it('a refused person asks for nothing: nothing was written', async () => {
    const { service, asked } = build(row({ id: 'e-1', status: 'refused', position: null }));

    await expect(service.enroll(SESSION, 'ana-row')).rejects.toThrow(/removed from this workshop/);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('a seat given up, or given', () => {
  it('a cancelled seat loses its alert, and the person promoted in its place gets hers', async () => {
    const { service, asked, writesWhenAsked } = build([
      row([{ id: 'e-1', status: 'confirmed' }]), // the delete, and the row it removed
      row({ id: 'e-2', user_id: 'zoe-row' }), // the top of the waitlist
      OK, // her promotion
      row([]), // nobody left on the waitlist
    ]);

    await service.cancel(SESSION, 'lea-row');

    expect(asked.mock.calls).toEqual([
      [SESSION, 'lea-row'],
      [SESSION, 'zoe-row'],
    ]);
    // Hers after the delete; Zoé's after her promotion.
    expect(writesWhenAsked).toEqual([1, 2]);
  });

  it('a seat whose alert cannot be removed still gives its place to the next person', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, supabase, asked, waitlistPromoted } = build([
      row([{ id: 'e-1', status: 'confirmed' }]),
      row({ id: 'e-2', user_id: 'zoe-row' }),
      OK,
      row([]),
    ]);
    asked.mockRejectedValueOnce(new Error('queue down'));

    await service.cancel(SESSION, 'lea-row');

    // The delete, then Zoé's promotion: the failed alert of the first skipped nothing.
    expect(writesTo(supabase, 'workshop_enrollments').map((write) => write.op)).toEqual([
      'delete',
      'update',
    ]);
    expect(waitlistPromoted.mock.calls).toEqual([[SESSION, 'zoe-row']]);
    expect(asked.mock.calls).toEqual([
      [SESSION, 'lea-row'],
      [SESSION, 'zoe-row'],
    ]);
  });

  it('a cancel with no booking left asks still: it repairs a cancel whose alert was not removed', async () => {
    const { service, supabase, asked } = build(row([]));

    await service.cancel(SESSION, 'lea-row');

    expect(asked.mock.calls).toEqual([[SESSION, 'lea-row']]);
    // The delete that found no row, and nothing after it.
    expect(writesTo(supabase, 'workshop_enrollments').map((write) => write.op)).toEqual(['delete']);
  });

  it.each<['promote' | 'accept']>([['promote'], ['accept']])(
    '%s of a waitlisted person asks for her alert, once she is confirmed',
    async (action) => {
      const { service, asked, writesWhenAsked } = build([
        row({ id: 'e-2', status: 'waitlisted' }),
        OK,
        row([]),
      ]);

      await service[action](SESSION, 'zoe-row');

      expect(asked.mock.calls).toEqual([[SESSION, 'zoe-row']]);
      expect(writesWhenAsked).toEqual([1]);
    },
  );

  it('a refused seat loses its alert, and the person promoted in its place gets hers', async () => {
    const { service, asked, writesWhenAsked } = build([
      row({ id: 'e-1', status: 'confirmed' }),
      OK, // the refusal
      row({ id: 'e-2', user_id: 'zoe-row' }),
      OK,
      row([]),
    ]);

    await service.refuse(SESSION, 'lea-row');

    expect(asked.mock.calls).toEqual([
      [SESSION, 'lea-row'],
      [SESSION, 'zoe-row'],
    ]);
    expect(writesWhenAsked).toEqual([1, 2]);
  });
});
