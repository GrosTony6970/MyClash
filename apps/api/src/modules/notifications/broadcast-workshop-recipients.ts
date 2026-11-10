/**
 * broadcast-workshop-recipients.ts — the two Workshop audiences of an organiser's broadcast
 * (operator rulings 533, 534).
 *
 * - "Workshop attendees": everyone with a seat or a waiting-list place in a session that still
 *   runs, in any Workshop of the Event, draft Workshops included. Who is told is owned by
 *   `bookedPersonIds`, the same rule as a Workshop's own message (531).
 * - "Instructors": everyone tagged as an instructor of the Event (`event_instructors`) and
 *   everyone named on one of its Workshops (`workshop_instructors`), as the rest of the app counts
 *   them (`me-events.service.ts` `fetchInstructorEventIds`). Both name a profile, so they reach
 *   people as referees are reached (`profileRecipients`). A Workshop instructor typed as a name
 *   only has no profile: nobody can be told, and the log says how many.
 *
 * A read that fails throws: read as "nobody", the broadcast would answer "No recipients matched".
 */
import { bookedPersonIds } from '../workshops/workshop-booked-people';
import {
  profileRecipients,
  type BroadcastRecipient,
  type ProfileRecipientsDeps,
} from './broadcast-profile-recipients';

/** The roster rows (`persons.id`) of the Event's Workshop attendees. */
export async function workshopAttendeeIds(
  deps: ProfileRecipientsDeps,
  eventId: string,
): Promise<string[]> {
  const workshopIds = await eventWorkshopIds(deps, eventId);
  return bookedPersonIds(deps.supabase.service, { workshopIds });
}

/** The Event's instructors, tagged on it or named on one of its Workshops. */
export async function instructorRecipients(
  deps: ProfileRecipientsDeps,
  eventId: string,
): Promise<BroadcastRecipient[]> {
  const tagged = await deps.supabase.service
    .from('event_instructors')
    .select('person_id')
    .eq('event_id', eventId);
  if (tagged.error) throw new Error(`Event instructors unreadable: ${tagged.error.message}`);
  const profiles = ((tagged.data ?? []) as Array<{ person_id: string }>).map((r) => r.person_id);

  const workshopIds = await eventWorkshopIds(deps, eventId);
  if (workshopIds.length > 0) {
    const named = await deps.supabase.service
      .from('workshop_instructors')
      .select('global_person_id')
      .in('workshop_id', workshopIds);
    if (named.error) throw new Error(`Workshop instructors unreadable: ${named.error.message}`);
    const rows = (named.data ?? []) as Array<{ global_person_id: string | null }>;
    const nameOnly = rows.filter((row) => !row.global_person_id).length;
    if (nameOnly > 0) {
      deps.logger.warn(
        `Broadcast of ${eventId}: ${nameOnly} name-only instructor(s) left out, no profile to tell`,
      );
    }
    profiles.push(...rows.flatMap((row) => (row.global_person_id ? [row.global_person_id] : [])));
  }

  const unique = Array.from(new Set(profiles));
  if (unique.length === 0) return [];
  return profileRecipients(deps, eventId, unique, 'instructor');
}

async function eventWorkshopIds(deps: ProfileRecipientsDeps, eventId: string): Promise<string[]> {
  const { data, error } = await deps.supabase.service
    .from('workshops')
    .select('id')
    .eq('event_id', eventId);
  if (error) throw new Error(`Workshops of the event unreadable: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}
