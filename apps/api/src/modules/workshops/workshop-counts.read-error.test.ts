/**
 * A count of bookings that could not be read is an error, never 0.
 *
 * Booking: the seat count of a full Workshop failed to read and counted 0 booked, so the next
 * person took a seat that was not there (`EnrollmentService.enroll`). Listing: the counts of a
 * Workshop list failed to read and showed every session with 0 booked, all seats free.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsService } from './workshops.service';

const DOWN = { data: null, count: null, error: { message: 'connection reset' } };

describe('a seat count that cannot be read', () => {
  it('books nobody: an over-booking was the price of reading it as 0', async () => {
    const supabase = mockSupabase({
      workshop_sessions: {
        rows: [{ id: 's-1', status: 'scheduled', workshop_id: 'w-1', workshops: { capacity: 2 } }],
      },
      persons: { rows: [{ id: 'p-1', global_person_id: null }] },
      // No booking of this person yet; then the seat count fails.
      workshop_enrollments: [{ data: null, error: null }, DOWN],
    });
    const service = new EnrollmentService(
      supabase as never,
      {} as never,
      { scheduleWorkshopSessionStarting: vi.fn() } as never,
    );

    await expect(service.enroll('s-1', 'p-1')).rejects.toThrow('connection reset');
    expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
  });
});

describe('the booking counts of a Workshop list that cannot be read', () => {
  it('fail the list, rather than show every seat free', async () => {
    const supabase = mockSupabase({ workshop_enrollments: DOWN });
    const service = new WorkshopsService(
      supabase as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const counts = (
      service as unknown as { confirmedCountsForWorkshops: (rows: unknown[]) => Promise<unknown> }
    ).confirmedCountsForWorkshops([{ workshop_sessions: [{ id: 's-1' }] }]);

    await expect(counts).rejects.toThrow('connection reset');
  });
});
