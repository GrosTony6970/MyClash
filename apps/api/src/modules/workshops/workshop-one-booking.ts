import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The bookings that hold a person's place in a Workshop (operator ruling 521): a seat, and a place
 * on the waitlist. A refusal is a removal from one session, not from the Workshop (ruling 522).
 * `intent` is the column's default, written by no door today, and counted as a place.
 */
export const PLACE_HOLDING_STATUSES = ['confirmed', 'waitlisted', 'intent'];

/**
 * One person, one session per Workshop (operator rulings 515, 520-523). "Longsword basics" runs
 * Saturday and Sunday: a person with a place on Saturday is refused Sunday, and told why; to
 * switch, she gives Saturday up first. It is the rule of every door that gives a place: her own
 * booking, the organiser's add (523), and an instructor taking a refusal back.
 *
 * Asked BEFORE any write, so a refused "Register again" keeps its refusal.
 *
 * The race, accepted: two bookings of one person landing at the same instant on two sessions of
 * the same Workshop (her own taps on two phones, or the organiser adding her while she books)
 * can both pass this read. She then holds two places, both on the rosters, and either can be
 * removed. Closing it needs a guard in the database, a column the Event archive must re-map or a
 * trigger, for a window of one request.
 */
export async function assertNoOtherBooking(
  db: SupabaseClient,
  workshopId: string,
  sessionId: string,
  personId: string,
): Promise<void> {
  // A cancelled session holds no place: its bookings stay, but the pages hide it, so a place in it
  // could neither be seen nor given up (the referee checker reads it the same way, ADR-016).
  const sessions = await db
    .from('workshop_sessions')
    .select('id')
    .eq('workshop_id', workshopId)
    .neq('status', 'cancelled');
  if (sessions.error) {
    throw new Error(
      `The sessions of workshop ${workshopId} were not read: ${sessions.error.message}`,
    );
  }
  const others = ((sessions.data ?? []) as Array<{ id: string }>)
    .map((s) => s.id)
    .filter((id) => id !== sessionId);
  if (others.length === 0) return;

  const held = await db
    .from('workshop_enrollments')
    .select('workshop_session_id')
    .eq('user_id', personId)
    .in('workshop_session_id', others)
    .in('status', PLACE_HOLDING_STATUSES)
    .limit(1);
  // A read that failed is an error: read as "no place", the person would take a second one.
  if (held.error) {
    throw new Error(
      `The places of ${personId} in workshop ${workshopId} were not read: ${held.error.message}`,
    );
  }
  if ((held.data ?? []).length > 0) {
    throw new ConflictException({
      error: 'WorkshopAlreadyBooked',
      message: 'This person already has a place in another session of this workshop.',
    });
  }
}

/** The same rule, for a door that knows the session only: its Workshop is read first. */
export async function assertNoOtherBookingFor(
  db: SupabaseClient,
  sessionId: string,
  personId: string,
): Promise<void> {
  const { data, error } = await db
    .from('workshop_sessions')
    .select('workshop_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`The workshop of session ${sessionId} was not read: ${error.message}`);
  const workshopId = (data as { workshop_id?: string | null } | null)?.workshop_id;
  if (workshopId) await assertNoOtherBooking(db, workshopId, sessionId, personId);
}
