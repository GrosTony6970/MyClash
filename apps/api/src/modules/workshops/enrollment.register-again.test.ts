/**
 * "Register again" (operator ruling 236).
 *
 * An instructor refuses Tom. His Workshops page tells him, and offers one button. One call
 * removes the refusal, and only a refusal, then books him as anybody: a seat, or the waitlist
 * when the session is full. A plain booking is still refused while the refusal is there
 * (ruling 219), which `enrollment.service.test.ts` holds ("blocks re-registration …").
 *
 * The race this holds: the refusal is taken back while Tom's page still shows it. A page that
 * cancelled and then booked would delete the seat just given back and hand it to the waitlist.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { WorkshopsController } from './workshops.controller';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const NONE = { data: null, error: null };
const OK = { data: null, error: null };
const row = (data: unknown) => ({ data, error: null });
const count = (n: number) => ({ data: null, error: null, count: n });
const REFUSAL = row({ id: 'e-1', status: 'refused', position: null });

/** `bookings` is a canned queue: what each read or write of the bookings answers, in call order. */
function build(bookings: TableSeed, capacity: number | null = null) {
  const supabase = mockSupabase({
    workshop_sessions: row({ workshop_id: 'w-1', workshops: { capacity } }),
    // Nobody here teaches the Workshop, and no profile flag is written.
    persons: row({ global_person_id: null }),
    workshop_enrollments: bookings,
  });
  const waitlistPromoted = vi.fn();
  const service = new EnrollmentService(
    supabase as never,
    { waitlistPromoted } as never,
    { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) } as never,
  );
  const writes = () =>
    writesTo(supabase, 'workshop_enrollments').map((write) => [
      write.op,
      write.filters.map((filter) => [filter.method, ...filter.args]),
    ]);
  return { service, writes, waitlistPromoted };
}

const refusalRemoved = (person: string) => [
  'delete',
  [
    ['eq', 'workshop_session_id', SESSION],
    ['eq', 'user_id', person],
    ['eq', 'status', 'refused'],
  ],
];

describe('a refused person registers again (ruling 236)', () => {
  it('removes the refusal, named by its status, then books a seat', async () => {
    const { service, writes } = build([OK, NONE, row({ id: 'e-2' })]);

    await expect(service.enroll(SESSION, 'tom-row', true)).resolves.toMatchObject({
      id: 'e-2',
      status: 'confirmed',
    });
    expect(writes()).toEqual([refusalRemoved('tom-row'), ['insert', []]]);
  });

  it('puts him on the waitlist when the session is full', async () => {
    const { service } = build([OK, NONE, count(1), count(2), row({ id: 'e-2' })], 1);

    await expect(service.enroll(SESSION, 'tom-row', true)).resolves.toMatchObject({
      status: 'waitlisted',
      waitlistPosition: 3,
    });
  });

  it('keeps a seat given back in the meantime: nothing but a refusal is removed, nobody is promoted', async () => {
    // The instructor accepted Tom again while his page still showed the refusal: the delete
    // names `refused`, matches nothing, and the booking that is read is his seat.
    const seat = row({ id: 'e-1', status: 'confirmed', position: null });
    const { service, writes, waitlistPromoted } = build([OK, seat]);

    await expect(service.enroll(SESSION, 'tom-row', true)).resolves.toMatchObject({
      id: 'e-1',
      status: 'confirmed',
    });
    expect(writes()).toEqual([refusalRemoved('tom-row')]);
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });

  it('refuses a plain booking, and removes nothing', async () => {
    const { service, writes } = build(REFUSAL);

    await expect(service.enroll(SESSION, 'tom-row')).rejects.toThrow(
      'You were removed from this workshop by the instructor.',
    );
    expect(writes()).toEqual([]);
  });

  it('answers a refusal that could not be removed with a plain Error, and books nothing', async () => {
    const { service, writes } = build({ data: null, error: { message: 'down' } });

    const failure = await service.enroll(SESSION, 'tom-row', true).catch((err: unknown) => err);

    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe('Refusal of tom-row in session s-1 not removed: down');
    expect(writes()).toEqual([refusalRemoved('tom-row')]);
  });
});

describe('POST workshop-sessions/:id/enroll', () => {
  it.each<[string | undefined, boolean]>([
    ['true', true],
    [undefined, false],
    ['1', false],
  ])('reads again=%s as %s, for the caller only', async (again, expected) => {
    const enroll = vi.fn(async () => ({}));
    const controller = new WorkshopsController(
      {} as never,
      { enroll } as never,
      {} as never,
      {} as never,
      {} as never,
      { requirePersonIdForSession: vi.fn() } as never,
    );
    vi.spyOn(
      controller as unknown as { resolvePersonId: () => Promise<string> },
      'resolvePersonId',
    ).mockResolvedValue('tom-row');

    await controller.enroll(SESSION, {} as never, again);

    expect(enroll.mock.calls).toEqual([[SESSION, 'tom-row', expected]]);
  });
});
