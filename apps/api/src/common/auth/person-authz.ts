/**
 * The Event-role check for a route addressed by person id.
 *
 * A person is on exactly one Event's roster (`persons.event_id` is required), so
 * the Event is read from the PERSON, never taken from the caller. Beside
 * `event-authz.ts` rather than in it only because that file is at its line budget.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assertCanManageEvent,
  MANAGE_EVENT_ROLE,
  type EventAuthzDeps,
  type OrgRole,
} from './event-authz';

/** The Event the person is on — `persons.event_id` — or null for no such person. */
export async function eventIdForPerson(
  supabase: EventAuthzDeps['supabase'],
  personId: string,
): Promise<string | null> {
  const { data, error } = await supabase.service
    .from('persons')
    .select('event_id')
    .eq('id', personId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  return data ? String((data as { event_id: string }).event_id) : null;
}

/**
 * Assert the caller holds `minRole` on the Event the person is on, and return
 * THAT EVENT's id — not the organisation's, unlike the `assertCanManage*` family:
 * the force-delete has to hold the Event it was sent to the person's own.
 * Reads pass `'read_only'`, the bar `assertEventMember` sets.
 */
export async function assertCanManagePerson(
  deps: EventAuthzDeps,
  personId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const eventId = await eventIdForPerson(deps.supabase, personId);
  if (!eventId) throw new NotFoundException(`Person ${personId} not found`);
  await assertCanManageEvent(deps, eventId, userId, minRole);
  return eventId;
}
