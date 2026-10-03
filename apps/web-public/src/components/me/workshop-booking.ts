// What the viewer's booking of a Workshop session IS, for the personal Workshops
// page. The schedule lists a seat and a waitlist place (marked), and names the
// sessions whose instructor refused the viewer apart (rulings 235, 236). Kept
// framework-free so it can be unit-tested in isolation.

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
