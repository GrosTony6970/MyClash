/**
 * The requests behind the buttons of a Workshop roster.
 *
 * Each one names the booking by its roster row (`personId`). The entry's `persons.id` is NOT that:
 * once an organiser links a booking to a profile it is the profile's id, and a request built on it
 * finds no booking. "Remove" deletes the listed person's booking (operator ruling 214); it used to
 * call the participant's own cancel, which removed the booking of the organiser who clicked.
 */
export function rosterRequests(sessionId: string, booking: { personId: string }) {
  const session = `/api/v1/workshop-sessions/${sessionId}`;
  return {
    remove: { path: `${session}/enrollments/${booking.personId}`, method: 'DELETE' },
    promote: { path: `${session}/promote/${booking.personId}`, method: 'POST' },
  } as const;
}
