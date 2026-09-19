/**
 * The Event-role checks for routes addressed by tournament or by registration,
 * the phase → tournament hop, and the check that the fighters a body names are
 * entered in a tournament.
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

/**
 * The tournament a phase belongs to — `phases.tournament_id`. `missing` is the
 * 404's sentence: it names the row the CALLER addressed (a bracket slot, a
 * match), not the phase in between.
 */
export async function tournamentIdForPhase(
  supabase: EventAuthzDeps['supabase'],
  phaseId: string,
  missing: string,
): Promise<string> {
  const { data, error } = await supabase.service
    .from('phases')
    .select('tournament_id')
    .eq('id', phaseId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(missing);
  return String((data as { tournament_id: string }).tournament_id);
}

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

/**
 * Refuse with `refusal` unless every registration named is entered in the
 * tournament. Null or undefined names nobody (an emptied side) and is not
 * looked up.
 *
 * The same 400 for a registration of another tournament and for no such
 * registration. Call it only after the role check on the tournament: a 403 or
 * a 404 would tell the caller which ids exist elsewhere.
 */
export async function assertEnteredInTournament(
  supabase: EventAuthzDeps['supabase'],
  tournamentId: string,
  registrationIds: ReadonlyArray<string | null | undefined>,
  refusal: string,
): Promise<void> {
  const named = registrationIds.filter((id): id is string => typeof id === 'string');
  if (named.length === 0) return;
  const { data, error } = await supabase.service
    .from('registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .in('id', named);
  if (error) throw new BadRequestException(error.message);
  const entered = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  if (named.some((id) => !entered.has(id))) throw new BadRequestException(refusal);
}
