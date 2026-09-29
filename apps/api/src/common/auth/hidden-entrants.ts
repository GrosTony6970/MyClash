/**
 * The people of one Event a caller must not find (ruling 129, the bar of 127): entered in a
 * Tournament hidden from the caller, with no live entry in a public one, and neither referee nor
 * instructor of the Event (ruling 167: they are public through that role, and only the draft
 * entry stays hidden). A person with no entry at all, a Workshop attendee, stays. For an insider
 * the set is empty and no entry is read.
 *
 * A draft entry of any status counts, a withdrawn one included. Only a live entry
 * (`ENTERED_STATUSES`) in a public Tournament keeps someone findable: the public roster lists no
 * one else (ruling 168). The persons lookup and the person page answer a hidden person exactly as
 * an unknown one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canReadEvent,
  type CompetitionEvent,
  hiddenTournamentIds,
  type PublicReader,
  THE_PUBLIC,
} from './competition-visibility';
import type { EventAuthzDeps } from './event-authz';

type Row = Record<string, string | null | undefined>;

/** A live entry: what the public roster lists. Withdrawn and disqualified ones are not. */
export const ENTERED_STATUSES = ['registered', 'checked_in', 'waitlist'];

/** A 5xx naming the read: a failed read is never "nobody hidden". */
async function rows(
  what: string,
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return (data ?? []) as Row[];
}

export async function hiddenEntrantIds(
  deps: EventAuthzDeps,
  event: CompetitionEvent,
  reader: PublicReader,
): Promise<Set<string>> {
  const hidden = await hiddenTournamentIds(deps, event, reader);
  if (hidden.size === 0) return new Set();
  const db = deps.supabase.service;
  const onlyHidden = await enteredOnlyIn(db, hidden);
  if (onlyHidden.length === 0) return new Set();
  const persons = await rows(
    'persons',
    db.from('persons').select('id, global_person_id').in('id', onlyHidden),
  );
  const staff = await eventStaff(db, event.id, persons);
  return new Set(
    persons.filter((row) => !staff.has(row.global_person_id)).map((row) => row.id as string),
  );
}

/**
 * The roster rows among these a reader may know of (rulings 164, 171a): the row's Event is one she
 * may see (`canReadEvent`), and the person is not entered there only in Tournaments hidden from her
 * (`hiddenEntrantIds`). For a list that hands someone roster rows of many Events: her own claimed
 * rows and the rows she may claim, read as her; the claim search's profiles, read as `THE_PUBLIC`.
 * A failed read is a 5xx.
 */
export async function knownRosterRows<RosterRow extends { id: string; eventId: string }>(
  deps: EventAuthzDeps,
  roster: RosterRow[],
  reader: PublicReader,
): Promise<RosterRow[]> {
  const eventIds = [...new Set(roster.map((row) => row.eventId))];
  if (eventIds.length === 0) return [];
  const events = await rows(
    'events',
    deps.supabase.service
      .from('events')
      .select('id, status, organization_id, event_kind')
      .in('id', eventIds),
  );
  // Absent: an Event she may not see (or an unknown one), so none of its rows is known.
  const hiddenByEvent = new Map<string, Set<string>>();
  for (const event of events as unknown as CompetitionEvent[]) {
    if (await canReadEvent(deps, event, reader)) {
      hiddenByEvent.set(event.id, await hiddenEntrantIds(deps, event, reader));
    }
  }
  return roster.filter((row) => hiddenByEvent.get(row.eventId)?.has(row.id) === false);
}

/**
 * The profiles among these the public may know of (rulings 171b, 173-175): one with no roster row
 * at all (an imported one), or with a roster row `knownRosterRows` lets `THE_PUBLIC` know of. A
 * profile known only through entries hidden from the public — a draft Tournament, a draft or test
 * Event — is not. For what spans many Events (ruling 163). A failed read is a 5xx: read as "no
 * roster row", every profile would be known.
 */
export async function publiclyKnownProfileIds(
  deps: EventAuthzDeps,
  profileIds: string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const persons = await rows(
    'profile roster',
    deps.supabase.service
      .from('persons')
      .select('id, event_id, global_person_id')
      .in('global_person_id', profileIds),
  );
  const roster = persons.map((row) => ({
    id: row.id as string,
    eventId: row.event_id as string,
    profileId: row.global_person_id as string,
  }));
  const known = new Set(
    (await knownRosterRows(deps, roster, THE_PUBLIC)).map((row) => row.profileId),
  );
  const listed = new Set(roster.map((row) => row.profileId));
  return new Set(profileIds.filter((id) => !listed.has(id) || known.has(id)));
}

/** Everyone entered in one of `hidden`, less anyone with a live entry in a public one too. */
async function enteredOnlyIn(db: SupabaseClient, hidden: Set<string>): Promise<string[]> {
  const drafted = await rows(
    'registrations',
    db
      .from('registrations')
      .select('person_id')
      .in('tournament_id', [...hidden]),
  );
  const candidates = [...new Set(drafted.map((row) => row.person_id as string))];
  if (candidates.length === 0) return [];
  const entries = await rows(
    'registrations',
    db
      .from('registrations')
      .select('person_id, tournament_id')
      .in('person_id', candidates)
      .in('status', ENTERED_STATUSES),
  );
  const elsewhere = new Set(
    entries.filter((row) => !hidden.has(row.tournament_id as string)).map((row) => row.person_id),
  );
  return candidates.filter((id) => !elsewhere.has(id));
}

/** The global ids among `persons` that referee or teach at the Event (both tables key on them). */
async function eventStaff(db: SupabaseClient, eventId: string, persons: Row[]) {
  const globalIds = persons.map((row) => row.global_person_id).filter((id): id is string => !!id);
  const staff = new Set<string | null | undefined>();
  if (globalIds.length === 0) return staff;
  for (const table of ['event_referees', 'event_instructors']) {
    const found = await rows(
      table.replace('_', ' '),
      db.from(table).select('person_id').eq('event_id', eventId).in('person_id', globalIds),
    );
    for (const row of found) staff.add(row.person_id);
  }
  return staff;
}
