/**
 * A person books only an open Workshop; the organiser may add a person to any.
 *
 * Lea knows the link of a Workshop the organiser is still preparing. The page does not list a
 * draft, but the booking door asked only whether the SESSION was cancelled, so a direct call took
 * a seat in a Workshop nobody had announced. Her own booking (`enrollOwn`) now asks the Workshop
 * to be published or running. The organiser's "add an attendee" (`enroll`) still books a draft:
 * the list is prepared before the Workshop is published.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const row = (data: unknown) => ({ data, error: null });

function build(workshopStatus: string) {
  const supabase = mockSupabase({
    workshop_sessions: row({
      status: 'scheduled',
      workshop_id: 'w-1',
      workshops: { capacity: null, status: workshopStatus },
    }),
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

describe('a person books only an open Workshop', () => {
  it.each([
    ['draft', false],
    ['completed', false],
    ['draft', true],
  ])(
    'refuses her own booking of a %s Workshop, writing nothing (again=%s)',
    async (status, again) => {
      const { service, supabase, alert } = build(status);

      const refusal = await service.enrollOwn(SESSION, 'lea-row', again).catch((e: unknown) => e);

      expect(refusal).toBeInstanceOf(HttpException);
      expect((refusal as HttpException).getStatus()).toBe(409);
      // The exception filter sends `error` as the code WORKSHOP_NOT_BOOKABLE.
      expect((refusal as HttpException).getResponse()).toEqual({
        error: 'WorkshopNotBookable',
        message: 'This workshop is not open for booking.',
      });
      // "Register again" removes no refusal for a booking that is then refused.
      expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
      expect(alert).not.toHaveBeenCalled();
    },
  );

  it.each(['published', 'running'])('books her own seat in a %s Workshop', async (status) => {
    const { service, supabase } = build(status);

    await expect(service.enrollOwn(SESSION, 'lea-row')).resolves.toMatchObject({
      id: 'e-1',
      status: 'confirmed',
    });
    // The double ignores the projection: only this holds the column the check reads.
    expect(selectsFor(supabase.from, 'workshop_sessions')).toEqual([
      'status, workshop_id, workshops ( capacity, status )',
    ]);
  });

  it('lets the organiser add a person to a draft Workshop', async () => {
    const { service } = build('draft');

    await expect(service.enroll(SESSION, 'lea-row')).resolves.toMatchObject({
      id: 'e-1',
      status: 'confirmed',
    });
  });
});
