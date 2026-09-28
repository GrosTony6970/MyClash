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
  type CompetitionEvent,
  hiddenTournamentIds,
  type PublicReader,
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
