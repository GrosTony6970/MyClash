import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedDay } from '@myclash/time';
import { eventZone, unknownZoneWarning } from '../../common/event-clock';

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

// ── The front desk (rulings 540, 543-547) ─────────────────────────────────────────────────────

/** Where an unknown Event zone is said; the desk passes its logger. */
export type Warn = (message: string) => void;

type One<T> = T | T[] | null;
const one = <T>(value: One<T> | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

interface DeskBooking {
  id: string;
  checked_in_at: string | null;
  workshop_sessions: One<{
    starts_at?: string | null;
    status?: string | null;
    workshops: One<{
      event_id: string;
      auto_check_in?: boolean;
      events: One<{ timezone: string | null }>;
    }>;
  }>;
}

/**
 * Whether two instants fall on the same day of the booking's Event clock. False for a booking of
 * another Event, and when either has no day (a session with no start).
 */
function sameEventDay(
  booking: DeskBooking,
  eventId: string,
  a: string | null | undefined,
  b: string | null | undefined,
  warn: Warn,
): boolean {
  const workshop = one(one(booking.workshop_sessions)?.workshops);
  if (workshop?.event_id !== eventId) return false;
  const timezone = one(workshop.events)?.timezone;
  const { zone, unknownZone } = eventZone(timezone);
  if (unknownZone) warn(unknownZoneWarning(eventId, timezone));
  const day = zonedDay(a, zone);
  return day !== null && day === zonedDay(b, zone);
}

/**
 * The desk marked the person arrived at `arrivedAt`: tick them in the sessions of that day, on
 * the Event's clock (544), of every Workshop whose switch is on (543), that still run and that
 * nobody tapped (545). A session with no start has no day. The tick carries the arrival time.
 *
 * Read, then one UPDATE that names the untapped and tickable state again: a tap or a refusal that
 * lands in between keeps its booking out. A failed read or write throws; the desk logs it.
 */
export async function tickFromDesk(
  db: SupabaseClient,
  eventId: string,
  personId: string,
  arrivedAt: string,
  warn: Warn,
): Promise<void> {
  const { data, error } = await db
    .from('workshop_enrollments')
    // The session, its Workshop and the Event clock: three real FKs. Written out, so the schema
    // gate (`db-schema-conformance.test.ts`) reads every column and embed of it.
    .select(
      'id, checked_in_at, workshop_sessions ( starts_at, status, workshops ( event_id, auto_check_in, events ( timezone ) ) )',
    )
    .eq('user_id', personId)
    .in('status', TICKABLE)
    .is('check_in_source', null);
  if (error) throw new Error(`The bookings of ${personId} were not read: ${error.message}`);
  const ids = ((data ?? []) as unknown as DeskBooking[])
    .filter((booking) => {
      const session = one(booking.workshop_sessions);
      if (session?.status === 'cancelled' || one(session?.workshops)?.auto_check_in !== true) {
        return false;
      }
      return sameEventDay(booking, eventId, session?.starts_at, arrivedAt, warn);
    })
    .map((booking) => booking.id);
  if (ids.length === 0) return;
  const { error: writeError } = await db
    .from('workshop_enrollments')
    .update({ checked_in_at: arrivedAt, check_in_source: 'desk' })
    .in('id', ids)
    .is('check_in_source', null)
    .in('status', TICKABLE);
  if (writeError) {
    throw new Error(`The desk ticks of ${personId} were not written: ${writeError.message}`);
  }
}

/**
 * The desk undid the person's arrival at `now`: remove the desk's ticks of THAT day (547), keyed on
 * each tick's own time, so a session moved to another day since is still found. No switch, status
 * or cancelled filter: a switch turned off, a session cancelled or a refusal since the arrival
 * must not keep a wrong person ticked. A tap (`hand`) is never touched (545).
 */
export async function untickFromDesk(
  db: SupabaseClient,
  eventId: string,
  personId: string,
  now: string,
  warn: Warn,
): Promise<void> {
  const { data, error } = await db
    .from('workshop_enrollments')
    .select('id, checked_in_at, workshop_sessions ( workshops ( event_id, events ( timezone ) ) )')
    .eq('user_id', personId)
    .eq('check_in_source', 'desk');
  if (error) throw new Error(`The desk ticks of ${personId} were not read: ${error.message}`);
  const ids = ((data ?? []) as unknown as DeskBooking[])
    .filter((booking) => sameEventDay(booking, eventId, booking.checked_in_at, now, warn))
    .map((booking) => booking.id);
  if (ids.length === 0) return;
  const { error: writeError } = await db
    .from('workshop_enrollments')
    .update({ checked_in_at: null, check_in_source: null })
    .in('id', ids)
    .eq('check_in_source', 'desk');
  if (writeError) {
    throw new Error(`The desk ticks of ${personId} were not removed: ${writeError.message}`);
  }
}
