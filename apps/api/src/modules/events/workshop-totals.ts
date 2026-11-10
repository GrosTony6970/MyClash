import type { SupabaseClient } from '@supabase/supabase-js';
import { isCancelledSession } from '@myclash/schedule-core';

/** What the Event overview shows a Workshops-only club in place of the fighter cards (slice 2.7). */
export interface WorkshopTotals {
  workshops: number;
  /** Sessions that are not cancelled. */
  sessions: number;
  /** Confirmed bookings in those sessions — the public page's "12 / 20" rule. */
  seatsTaken: number;
  /** Seats in those sessions; null when one of them has no limit (no honest total). */
  seats: number | null;
  /** People waiting for a seat in those sessions. */
  waitlisted: number;
}

interface WorkshopRow {
  capacity: number | null;
  workshop_sessions: Array<{ id: string; status: string | null }> | null;
}

/**
 * Counts an Event's Workshops for its overview. A cancelled session counts nowhere: it does
 * nothing (rulings 526-529), so its bookings are no seats taken and its waitlist waits for nothing.
 * A read that fails throws: read as zero, the overview would say the Event has no Workshops.
 */
export async function readWorkshopTotals(
  db: SupabaseClient,
  eventId: string,
): Promise<WorkshopTotals> {
  const { data, error } = await db
    .from('workshops')
    .select('id, capacity, workshop_sessions ( id, status )')
    .eq('event_id', eventId);
  if (error) throw new Error(`The Workshops of the Event were not counted: ${error.message}`);
  const workshops = (data ?? []) as unknown as WorkshopRow[];

  const liveIds: string[] = [];
  let seats: number | null = 0;
  for (const workshop of workshops) {
    for (const session of workshop.workshop_sessions ?? []) {
      if (isCancelledSession(session)) continue;
      liveIds.push(session.id);
      seats = workshop.capacity == null || seats == null ? null : seats + workshop.capacity;
    }
  }

  let seatsTaken = 0;
  let waitlisted = 0;
  if (liveIds.length > 0) {
    const { data: bookings, error: bookingsError } = await db
      .from('workshop_enrollments')
      .select('workshop_session_id, status')
      .in('workshop_session_id', liveIds)
      .in('status', ['confirmed', 'waitlisted']);
    if (bookingsError) {
      throw new Error(`The bookings of the Workshops were not counted: ${bookingsError.message}`);
    }
    for (const booking of (bookings ?? []) as Array<{ status: string }>) {
      if (booking.status === 'confirmed') seatsTaken++;
      else if (booking.status === 'waitlisted') waitlisted++;
    }
  }

  return { workshops: workshops.length, sessions: liveIds.length, seatsTaken, seats, waitlisted };
}
