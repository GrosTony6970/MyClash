// What the viewer's booking of a Workshop session IS, for the personal Workshops
// page and the public Workshop page (a guest's door, ruling 261). The schedule
// lists a seat and a waitlist place (marked), and names the sessions whose
// instructor refused the viewer apart (rulings 235, 236). Kept framework-free so
// it can be unit-tested in isolation.

import { apiRequest, failureCode, type ApiFailure } from '@myclash/api-client';
import type { PersonSchedule } from './types';

export type WorkshopBooking = 'none' | 'confirmed' | 'waitlisted' | 'refused';

/** Session id → the viewer's booking of it. A session with no entry is not booked. */
export function bookingsOf(schedule: PersonSchedule | null): Map<string, WorkshopBooking> {
  const bookings = new Map<string, WorkshopBooking>();
  for (const w of schedule?.workshops ?? []) {
    bookings.set(w.workshopId, w.status === 'waitlisted' ? 'waitlisted' : 'confirmed');
  }
  for (const sessionId of schedule?.refusedWorkshopIds ?? []) bookings.set(sessionId, 'refused');
  return bookings;
}

/**
 * Where one tap on "Register" posts. A refusal is a removal, not a ban (ruling
 * 219), but a plain booking is refused while it is there: "Register again" asks
 * the API to remove the refusal first, in the same call (ruling 236). The page
 * never cancels then books: a refusal taken back in between is a seat, and a
 * cancel would give it away.
 */
export function enrollPath(sessionId: string, booking: WorkshopBooking): string {
  const path = `/api/v1/workshop-sessions/${sessionId}/enroll`;
  return booking === 'refused' ? `${path}?again=true` : path;
}

/**
 * The caller's bookings at an Event, from her own schedule: an account's, or a
 * guest session's. The server says who the caller is; a page cannot, because
 * both login cookies are httpOnly.
 *
 * A 401 is read as nobody at this Event, so nothing is booked: no login and no
 * guest session, or an account with no roster row there. Any other failure is
 * `null`, no verdict: the page keeps what it shows.
 */
export async function readBookings(
  apiUrl: string,
  eventSlug: string,
  signal?: AbortSignal,
): Promise<Map<string, WorkshopBooking> | null> {
  const result = await apiRequest<PersonSchedule>(
    apiUrl,
    `/api/v1/events/${encodeURIComponent(eventSlug)}/my-schedule`,
    { signal },
  );
  if (result.ok) return bookingsOf(result.data);
  return result.kind === 'unauthenticated' && result.status === 401 ? new Map() : null;
}

/** Why the server refused a tap, as far as a page has its own words for it. */
export type BookingRefusal = 'nobody' | 'teaches' | 'removed' | 'other';

export type BookingChange =
  | { ok: true; status: 'confirmed' | 'waitlisted' | 'cancelled' }
  | { ok: false; why: BookingRefusal; failure: ApiFailure };

const REFUSAL_CODES = new Map<string, BookingRefusal>([
  ['INSTRUCTOR_SELF_ENROLLMENT', 'teaches'],
  ['WORKSHOP_BOOKING_REFUSED', 'removed'],
]);

/** One tap on a session, as one call: book (or book again), or give the booking up. */
export async function changeBooking(
  apiUrl: string,
  sessionId: string,
  action: 'book' | 'cancel',
  booking: WorkshopBooking,
): Promise<BookingChange> {
  const result =
    action === 'book'
      ? await apiRequest<{ status: string }>(apiUrl, enrollPath(sessionId, booking), {
          method: 'POST',
        })
      : await apiRequest<unknown>(apiUrl, enrollPath(sessionId, 'none'), { method: 'DELETE' });
  if (!result.ok) {
    const nobody = result.kind === 'unauthenticated' && result.status === 401;
    const why = nobody ? 'nobody' : (REFUSAL_CODES.get(failureCode(result) ?? '') ?? 'other');
    return { ok: false, why, failure: result };
  }
  if (action === 'cancel') return { ok: true, status: 'cancelled' };
  const { status } = result.data as { status: string };
  return { ok: true, status: status === 'waitlisted' ? 'waitlisted' : 'confirmed' };
}
