/**
 * The Event-role checks for routes addressed by tournament or by registration.
 *
 * The Event is read from the ROW — tournament → Event, registration →
 * tournament → Event — never taken from the caller. The two `assertCanManage*`
 * here return THAT EVENT's id, as `assertCanManagePerson` does and unlike the
 * `event-authz` family, which returns the organisation's: registering a person
 * must hold the person's Event to the tournament's. Beside `event-authz.ts`
 * rather than in it only because that file is at its line budget; the
 * tournament hop is its own.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assertCanManageEvent,
  eventIdForTournament,
  MANAGE_EVENT_ROLE,
  type EventAuthzDeps,
  type OrgRole,
} from './event-authz';
import { eventIdForPerson } from './person-authz';

/** Assert the caller holds `minRole` on the tournament's Event; return the Event id. */
export async function assertCanManageTournament(
  deps: EventAuthzDeps,
  tournamentId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const eventId = await eventIdForTournament(deps.supabase, tournamentId);
  await assertCanManageEvent(deps, eventId, userId, minRole);
  return eventId;
}

/** Assert the caller holds `minRole` on the registration's Event; return the Event id. */
export async function assertCanManageRegistration(
  deps: EventAuthzDeps,
  registrationId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const { data, error } = await deps.supabase.service
    .from('registrations')
    .select('tournament_id')
    .eq('id', registrationId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Registration ${registrationId} not found`);
  const tournamentId = String((data as { tournament_id: string }).tournament_id);
  return assertCanManageTournament(deps, tournamentId, userId, minRole);
}

/**
 * Assert the caller may enter `personId` in the tournament: `editor` on its
 * Event, and the person on that Event's roster. A person id is the caller's to
 * send, and a person from another Event's roster would carry that roster's
 * details — email included — into this tournament's list.
 *
 * The same 400 for a person on another Event and for no such person: once the
 * two Events must be one, the tournament's check is the whole role check, and a
 * 403 or a 404 would tell the caller which ids exist elsewhere.
 */
export async function assertCanRegister(
  deps: EventAuthzDeps,
  tournamentId: string,
  personId: string,
  userId: string,
): Promise<void> {
  const eventId = await assertCanManageTournament(deps, tournamentId, userId);
  if ((await eventIdForPerson(deps.supabase, personId)) !== eventId) {
    throw new BadRequestException(`Person ${personId} is not on the roster of this Event`);
  }
}
