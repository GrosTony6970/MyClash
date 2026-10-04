/**
 * A cancelled session takes no booking.
 *
 * The public pages do not list a cancelled session, but a page opened before the
 * organiser cancelled it still shows "Register", and the organiser's own "add an
 * attendee" route books through the same door. The door refused nothing: the tap
 * gave a seat in a session that will not run.
 *
 * Asked before any write, "Register again" included: a refusal is not removed
 * for a booking that is then refused.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const row = (data: unknown) => ({ data, error: null });

function build(status: string) {
  const supabase = mockSupabase({
    workshop_sessions: row({ status, workshop_id: 'w-1', workshops: { capacity: null } }),
    // Nobody here teaches the Workshop, and no profile flag is written.
    persons: row({ global_person_id: null }),
    // No booking yet, then the insert's read-back.
    workshop_enrollments: [row(null), row({ id: 'e-1' })],
  });
  const alert = vi.fn().mockResolvedValue(undefined);
  const service = new EnrollmentService(
    supabase as never,
    {} as never,
    { scheduleWorkshopSessionStarting: alert } as never,
  );
  return { service, supabase, alert };
}

describe('a cancelled session takes no booking', () => {
  it.each([false, true])('refuses the booking and writes nothing (again=%s)', async (again) => {
    const { service, supabase, alert } = build('cancelled');

    const refusal = await service.enroll(SESSION, 'lea-row', again).catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(409);
    // The exception filter sends `error` as the code WORKSHOP_SESSION_CANCELLED.
    expect((refusal as HttpException).getResponse()).toEqual({
      error: 'WorkshopSessionCancelled',
      message: 'This workshop session was cancelled.',
    });
    expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it.each(['scheduled', 'running', 'completed'])('books a %s session', async (status) => {
    const { service, supabase } = build(status);

    await expect(service.enroll(SESSION, 'lea-row')).resolves.toMatchObject({
      id: 'e-1',
      status: 'confirmed',
    });
    // The double ignores the projection: only this holds the column the check reads.
    expect(selectsFor(supabase.from, 'workshop_sessions')).toEqual([
      'status, workshop_id, workshops ( capacity )',
    ]);
  });
});
