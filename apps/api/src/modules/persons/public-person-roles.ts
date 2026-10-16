import {
  type CompetitionEvent,
  type PublicReader,
  visibleTournaments,
} from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
// The entries the public roster lists (`listPublicParticipants`): withdrawn ones are not.
import { ENTERED_STATUSES } from '../../common/auth/hidden-entrants';

export type PublicPersonRole = 'competitor' | 'referee' | 'instructor';

/** A person of the Event, as the role reads need them. */
export interface RolePerson {
  id: string;
  /** `event_referees` and `event_instructors` key the GLOBAL person, as the roster reads it. */
  global_person_id: string | null;
}

/**
 * The roles the public shows of an Event's people (ONE owner: the person page, the People
 * search): an entry in a Tournament the caller may see (a draft one is no role for an outsider,
 * ruling 127a), a referee of the Event, an instructor of the Event. In that order, for each
 * person; a person with none has an empty list. A failed read throws, never "no role".
 *
 * Four reads for any number of people: the Tournaments, the entries, the referees, the
 * instructors. A person with no global profile is no referee and no instructor, and if nobody has
 * one, the two staff tables are not read.
 */
export async function publicRolesOf(
  deps: EventAuthzDeps,
  event: CompetitionEvent,
  persons: readonly RolePerson[],
  reader: PublicReader,
): Promise<Map<string, PublicPersonRole[]>> {
  const globalIds = [...new Set(persons.flatMap((p) => p.global_person_id ?? []))];
  const [competing, refereeing, teaching] = await Promise.all([
    competingIds(deps, event, persons, reader),
    staffIds(deps, 'event_referees', 'event referees', event.id, globalIds),
    staffIds(deps, 'event_instructors', 'event instructors', event.id, globalIds),
  ]);
  return new Map(
    persons.map((person) => {
      const roles: PublicPersonRole[] = [];
      if (competing.has(person.id)) roles.push('competitor');
      if (person.global_person_id && refereeing.has(person.global_person_id)) roles.push('referee');
      if (person.global_person_id && teaching.has(person.global_person_id))
        roles.push('instructor');
      return [person.id, roles];
    }),
  );
}

/** The ids of these persons entered in a Tournament of the Event the caller may see. */
async function competingIds(
  deps: EventAuthzDeps,
  event: CompetitionEvent,
  persons: readonly RolePerson[],
  reader: PublicReader,
): Promise<Set<string>> {
  if (persons.length === 0) return new Set();
  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select('id, status')
    .eq('event_id', event.id);
  if (error) throw new Error(`tournaments read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; status: string }>;
  const visible = await visibleTournaments(deps, event, rows, reader);
  if (visible.length === 0) return new Set();
  const { data: entries, error: entryError } = await deps.supabase.service
    .from('registrations')
    .select('person_id')
    .in(
      'person_id',
      persons.map((p) => p.id),
    )
    .in(
      'tournament_id',
      visible.map((tournament) => tournament.id),
    )
    .in('status', ENTERED_STATUSES);
  if (entryError) throw new Error(`registrations read failed: ${entryError.message}`);
  return new Set(((entries ?? []) as Array<{ person_id: string }>).map((e) => e.person_id));
}

/** The global persons among `globalIds` on one of the Event's staff tables. */
async function staffIds(
  deps: EventAuthzDeps,
  table: 'event_referees' | 'event_instructors',
  what: string,
  eventId: string,
  globalIds: readonly string[],
): Promise<Set<string>> {
  if (globalIds.length === 0) return new Set();
  const { data, error } = await deps.supabase.service
    .from(table)
    .select('person_id')
    .eq('event_id', eventId)
    .in('person_id', [...globalIds]);
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ person_id: string }>).map((row) => row.person_id));
}
