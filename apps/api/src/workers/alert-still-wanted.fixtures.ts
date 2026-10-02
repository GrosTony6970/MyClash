/**
 * Léa's bout, duty, Workshop and seat for the tests of the fire-time "still wanted" check (ruling
 * 213), split out when one test file reached the 400-line cap. Test-only: it is imported by tests
 * and nothing else.
 */
import type { TableSeed } from '../common/testing/supabase-chain';

const PUBLIC = { tournaments: { status: 'published', events: { status: 'published' } } };
export const bout = (id: string, red: string, blue: string) => ({
  id,
  red_registration_id: `reg-${red}`,
  blue_registration_id: `reg-${blue}`,
  phases: PUBLIC,
});
export const rosterRow = (
  id: string,
  profile: string,
  eventId: string,
  account: string | null,
) => ({
  id,
  global_person_id: profile,
  event_id: eventId,
  claimed_by_user_id: account,
});
const ALL_ON = {
  notify_match_start: true,
  notify_referee_start: true,
  notify_workshop_start: true,
};
export const follow = (
  follower: string,
  person: string,
  switches: Partial<typeof ALL_ON> = {},
) => ({
  id: `${follower}-${person}`,
  follower_user_id: follower,
  followed_person_id: person,
  ...ALL_ON,
  ...switches,
});
export const seat = (row: string, status: string, session = 'session-1') => ({
  id: `seat-${row}`,
  workshop_session_id: session,
  user_id: row,
  status,
});

/**
 * Léa fights Tom in bout-1; Zoé fights Ana in bout-2. Léa referees duty-1 and teaches the Workshop
 * of session-1, all in event-1; she is also on the roster of event-2. Marc follows Léa. Léa holds a
 * confirmed seat in session-1, Tom is on its waitlist.
 */
export function tables(): Record<string, TableSeed> {
  return {
    matches: { rows: [bout('bout-1', 'lea', 'tom'), bout('bout-2', 'zoe', 'ana')] },
    registrations: {
      rows: ['lea', 'tom', 'zoe', 'ana'].map((id) => ({ id: `reg-${id}`, person_id: id })),
    },
    persons: {
      rows: [
        rosterRow('lea', 'gp-lea', 'event-1', 'u-lea'),
        rosterRow('tom', 'gp-tom', 'event-1', 'u-tom'),
        rosterRow('zoe', 'gp-zoe', 'event-1', 'u-zoe'),
        rosterRow('ana', 'gp-ana', 'event-1', null),
        rosterRow('lea-elsewhere', 'gp-lea', 'event-2', 'u-lea'),
      ],
    },
    follows: { rows: [follow('marc', 'lea'), follow('nina', 'zoe')] },
    referee_assignments: { rows: [{ id: 'duty-1', person_id: 'gp-lea', event_id: 'event-1' }] },
    workshop_sessions: {
      rows: [{ id: 'session-1', workshop_id: 'w-1', workshops: { event_id: 'event-1' } }],
    },
    workshop_instructors: {
      rows: [
        { workshop_id: 'w-1', global_person_id: 'gp-lea' },
        // An instructor typed as text only: no profile.
        { workshop_id: 'w-1', global_person_id: null },
        { workshop_id: 'w-2', global_person_id: 'gp-tom' },
      ],
    },
    workshop_enrollments: { rows: [seat('lea', 'confirmed'), seat('tom', 'waitlisted')] },
  };
}

export const follows = (...rows: Array<ReturnType<typeof follow>>) => ({ follows: { rows } });
