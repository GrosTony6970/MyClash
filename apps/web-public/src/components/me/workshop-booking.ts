// What the viewer's booking of a Workshop session IS, for the personal Workshops
// page and the public Workshop page (a guest's door, ruling 261). The schedule
// lists a seat and a waitlist place (marked), and names the sessions whose
// instructor refused the viewer apart (rulings 235, 236). Kept framework-free so
// it can be unit-tested in isolation.

import {
  apiRequest,
  failureCode,
  failureMessage,
  fetchMe,
  type ApiFailure,
  type MeSession,
} from '@myclash/api-client';
import { isCancelledSession } from '../workshops/session-cancelled';
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
 * The other session of the same Workshop where the viewer holds a place, or null (rulings 520,
 * 521). A seat or a place on the waitlist holds the Workshop: every other session of it is
 * refused until that place is given up. A refusal holds nothing (ruling 522).
 */
export function placeElsewhere(
  sessionIds: readonly string[],
  sessionId: string,
  bookings: ReadonlyMap<string, WorkshopBooking>,
): string | null {
  const holds = (id: string) => {
    const booking = bookings.get(id);
    return booking === 'confirmed' || booking === 'waitlisted';
  };
  return sessionIds.find((id) => id !== sessionId && holds(id)) ?? null;
}

/**
 * The words of the greyed button of a session refused because the viewer holds another one of
 * the same Workshop ("You have a place on Sat 10:00"), or null. One owner for both booking pages.
 * `when` writes an instant in the reader's language and the Event's zone. A place in a cancelled
 * session holds nothing (ruling 526, as the server's rule): it is never the other place.
 */
export function placeElsewhereWords(
  sessions: ReadonlyArray<{ id: string; startsAt: string | null; status?: string | null }>,
  sessionId: string,
  bookings: ReadonlyMap<string, WorkshopBooking>,
  t: (key: string, values?: Record<string, string>) => string,
  when: (iso: string) => string,
): string | null {
  const otherId = placeElsewhere(
    sessions.filter((s) => !isCancelledSession(s)).map((s) => s.id),
    sessionId,
    bookings,
  );
  if (!otherId) return null;
  const startsAt = sessions.find((s) => s.id === otherId)?.startsAt;
  return startsAt
    ? t('publicApp.me.workshops.placeElsewhere', { when: when(startsAt) })
    : t('publicApp.me.workshops.placeElsewhereNoTime');
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
 * The sessions with a tap in flight, on a booking page. A page that held one id
 * freed the first button at a tap on a second session, with its call still out.
 */
export type TapsInFlight = ReadonlySet<string>;

export const tapStarted = (taps: TapsInFlight, sessionId: string): TapsInFlight =>
  new Set(taps).add(sessionId);

export function tapEnded(taps: TapsInFlight, sessionId: string): TapsInFlight {
  const rest = new Set(taps);
  rest.delete(sessionId);
  return rest;
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
export type BookingRefusal =
  'nobody' | 'teaches' | 'removed' | 'cancelled' | 'closed' | 'booked' | 'other';

export type BookingChange =
  | { ok: true; status: 'confirmed' | 'waitlisted' | 'cancelled' }
  | { ok: false; why: BookingRefusal; failure: ApiFailure };

const REFUSAL_CODES = new Map<string, BookingRefusal>([
  ['INSTRUCTOR_SELF_ENROLLMENT', 'teaches'],
  ['WORKSHOP_BOOKING_REFUSED', 'removed'],
  ['WORKSHOP_SESSION_CANCELLED', 'cancelled'],
  ['WORKSHOP_NOT_BOOKABLE', 'closed'],
  // A place in another session of the same Workshop (rulings 520, 521).
  ['WORKSHOP_ALREADY_BOOKED', 'booked'],
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
  // Read with `?.`: a 2xx with no body must not throw out of a page's tap handler.
  const status = (result.data as { status?: string } | null)?.status;
  return { ok: true, status: status === 'waitlisted' ? 'waitlisted' : 'confirmed' };
}

/**
 * A refused tap, in the reader's language: the ONE owner for both booking pages
 * (operator ruling 294). The booking door's own four refusals have a sentence
 * here. Any other failure is worded by `failureMessage`, a lost login included;
 * the public Workshop page says its own notice for that one (ruling 266).
 */
export function refusalWords(
  change: Extract<BookingChange, { ok: false }>,
  t: (key: string) => string,
): string | null {
  if (change.why === 'teaches') return t('publicApp.workshopDetail.instructorCannotEnroll');
  if (change.why === 'removed') return t('publicApp.me.workshops.refused');
  if (change.why === 'cancelled') return t('publicApp.workshopDetail.sessionCancelled');
  if (change.why === 'closed') return t('publicApp.workshopDetail.notBookable');
  if (change.why === 'booked') return t('publicApp.workshopDetail.alreadyBooked');
  return failureMessage(change.failure, t);
}

/**
 * An instructor's accept or refuse that the server refused, in the reader's language. A refusal
 * taken back while the person holds another session of the Workshop is named (rulings 520-523),
 * and so is an accept in a session cancelled since the roster opened (ruling 526); any other is
 * the dashboard's plain "try again".
 */
export function moderationRefusalWords(failure: ApiFailure, t: (key: string) => string): string {
  const code = failureCode(failure);
  if (code === 'WORKSHOP_ALREADY_BOOKED') return t('publicApp.me.instructor.alreadyBooked');
  if (code === 'WORKSHOP_SESSION_CANCELLED') return t('publicApp.workshopDetail.sessionCancelled');
  return t('publicApp.me.instructor.actionError');
}

/**
 * The instructor ticks a person present in a session, or clears the tick (operator rulings
 * 539-545). Named by the booking's roster row. A tick changes no booking.
 */
export function checkInPath(sessionId: string, personId: string): string {
  return `/api/v1/workshop-sessions/${sessionId}/enrollments/${personId}/check-in`;
}

/** The bookings a "Present" box is drawn for: a seat or a waiting-list place, never a refusal (541). */
export function canTick(status: string): boolean {
  return status === 'confirmed' || status === 'waitlisted';
}

/** A refused tick, in the reader's language. Any other failure is the dashboard's "try again". */
export function checkInRefusalWords(failure: ApiFailure, t: (key: string) => string): string {
  const code = failureCode(failure);
  if (code === 'CHECK_IN_REFUSED_BOOKING') return t('publicApp.me.instructor.checkInRefused');
  if (code === 'WORKSHOP_SESSION_CANCELLED') return t('publicApp.workshopDetail.sessionCancelled');
  return t('publicApp.me.instructor.actionError');
}
