// What the viewer's booking of a Workshop session IS, for the personal Workshops
// page and the public Workshop page (a guest's door, ruling 261). The schedule
// lists a seat and a waitlist place (marked), and names the sessions whose
// instructor refused the viewer apart (rulings 235, 236). Kept framework-free so
// it can be unit-tested in isolation.

import {
  apiRequest,
  failureCode,
  fetchMe,
  type ApiFailure,
  type MeSession,
} from '@myclash/api-client';
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

/** What a page knows of the caller at an Event: her bookings, and her schedule for the clash check. */
export interface CallerBookings {
  bookings: Map<string, WorkshopBooking>;
  /** Null for nobody: nothing to clash with. */
  schedule: PersonSchedule | null;
}

/**
 * The caller's bookings at an Event, from her own schedule: an account's, or a
 * guest session's. The server says who the caller is; a page cannot, because
 * both login cookies are httpOnly.
 *
 * A 401 is read as nobody at this Event, so nothing is booked: no login and no
 * guest session, or an account with no roster row there. Any other failure is
 * `null`, no verdict: the page keeps what it shows, and says the read failed
 * (operator ruling 271).
 */
export async function readBookings(
  apiUrl: string,
  eventSlug: string,
  signal?: AbortSignal,
): Promise<CallerBookings | null> {
  const result = await apiRequest<PersonSchedule>(
    apiUrl,
    `/api/v1/events/${encodeURIComponent(eventSlug)}/my-schedule`,
    { signal },
  );
  if (result.ok) return { bookings: bookingsOf(result.data), schedule: result.data };
  return result.kind === 'unauthenticated' && result.status === 401
    ? { bookings: new Map(), schedule: null }
    : null;
}

/**
 * Who the server did not know at the booking door (operator ruling 266). A
 * visitor has no login: she finds her name on the roster, or signs in. An
 * account IS signed in and has no roster row at this Event: "sign in" would be
 * false, only the organiser can add it.
 *
 * Asked after a refused tap only. A `/me` that cannot be read is no proof of an
 * account, so it reads as a visitor: her notice holds both ways out.
 */
export type UnknownCaller = 'visitor' | 'account';

export async function unknownCaller(apiUrl: string): Promise<UnknownCaller> {
  const me = await fetchMe(apiUrl);
  return me.ok && me.data.type === 'claimed' ? 'account' : 'visitor';
}

/**
 * The roster person of a guest session at THIS Event, or null (operator ruling
 * 267): a guest gets no alert, and the page tells her so. A guest session of
 * another Event is nobody here.
 */
export function guestPersonAt(me: MeSession | null, eventId: string | null): string | null {
  if (me?.type !== 'guest' || !me.person || !eventId) return null;
  return me.person.event_id === eventId ? me.person.id : null;
}

/** Why the server refused a tap, as far as a page has its own words for it. */
export type BookingRefusal = 'nobody' | 'teaches' | 'removed' | 'cancelled' | 'other';

export type BookingChange =
  | { ok: true; status: 'confirmed' | 'waitlisted' | 'cancelled' }
  | { ok: false; why: BookingRefusal; failure: ApiFailure };

const REFUSAL_CODES = new Map<string, BookingRefusal>([
  ['INSTRUCTOR_SELF_ENROLLMENT', 'teaches'],
  ['WORKSHOP_BOOKING_REFUSED', 'removed'],
  ['WORKSHOP_SESSION_CANCELLED', 'cancelled'],
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
