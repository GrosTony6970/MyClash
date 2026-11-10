import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who was in a Workshop session's room (operator rulings 539-549). The ONE writer of a booking's
 * `checked_in_at` and `check_in_source` (0259).
 *
 * A tick is information only: it never changes a booking, and a seat is enough to rate (539).
 * A seat or a waiting-list place can be ticked; a refused person cannot (541). Once somebody taps
 * a booking (`hand`), the front desk never touches it again (545).
 */

/** The bookings a tick may land on: a seat or a waiting-list place (541). */
export const TICKABLE = ['confirmed', 'waitlisted'] as const;

/** The refusal of a tick on a refused booking, named so a page says it in the reader's language. */
export function checkInRefusedBooking(): ConflictException {
  return new ConflictException({
    error: 'CheckInRefusedBooking',
    message: 'A refused person cannot be ticked present.',
  });
}

/**
 * The instructor's or a Workshop lead's tap: ticked present now, or cleared. Either way the
 * booking is `hand` from then on (545). One UPDATE scoped by session, person AND a tickable status,
 * so a refusal that lands first turns the tap into a 409, never a tick on a refused row.
 *
 * 404 for no booking, or one that is not a live booking (`intent`, `cancelled`).
 */
export async function tickByHand(
  db: SupabaseClient,
  sessionId: string,
  personId: string,
  present: boolean,
): Promise<{ checkedInAt: string | null }> {
  const { data, error } = await db
    .from('workshop_enrollments')
    .update({ checked_in_at: present ? new Date().toISOString() : null, check_in_source: 'hand' })
    .eq('workshop_session_id', sessionId)
    .eq('user_id', personId)
    .in('status', TICKABLE)
    .select('id, checked_in_at');
  if (error)
    throw new Error(
      `The check-in of ${personId} in ${sessionId} was not written: ${error.message}`,
    );
  const written = (data ?? []) as Array<{ checked_in_at: string | null }>;
  if (written.length > 0) return { checkedInAt: written[0]!.checked_in_at };

  const { data: booking, error: readError } = await db
    .from('workshop_enrollments')
    .select('status')
    .eq('workshop_session_id', sessionId)
    .eq('user_id', personId)
    .maybeSingle();
  if (readError) {
    throw new Error(
      `The booking of ${personId} in ${sessionId} was not read: ${readError.message}`,
    );
  }
  if ((booking as { status?: string } | null)?.status === 'refused') throw checkInRefusedBooking();
  throw new NotFoundException(`No booking of ${personId} in session ${sessionId}`);
}
