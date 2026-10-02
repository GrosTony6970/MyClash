/**
 * A refusal is a removal, not a ban (operator ruling 219).
 *
 * An instructor refuses Tom. Tom taps "Cancel" on his own page: his booking is deleted, refusal
 * included, and he may book again; the instructor refuses him again if needed. The operator was
 * asked whether the refusal should stay, and left it as it is. This holds that choice: the cancel
 * deletes the booking whatever its state. That a refusal still in place stops a new booking is
 * held by `enrollment.service.test.ts` ("blocks re-registration …").
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';

describe('a refused person cancels his own booking (ruling 219)', () => {
  it('deletes the booking by session and person, whatever its state, and promotes nobody', async () => {
    const supabase = mockSupabase({
      // What the delete hands back: the refusal it removed.
      workshop_enrollments: { data: [{ id: 'e-1', status: 'refused' }], error: null },
    });
    const waitlistPromoted = vi.fn();
    const service = new EnrollmentService(
      supabase as never,
      { waitlistPromoted } as never,
      { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.cancel(SESSION, 'tom-row');

    expect(
      writesTo(supabase, 'workshop_enrollments').map((write) => [
        write.op,
        write.filters.map((filter) => [filter.method, ...filter.args]),
      ]),
    ).toEqual([
      [
        'delete',
        [
          ['eq', 'workshop_session_id', SESSION],
          ['eq', 'user_id', 'tom-row'],
        ],
      ],
    ]);
    // A refusal held no seat and no place on the waitlist.
    expect(waitlistPromoted).not.toHaveBeenCalled();
  });
});
