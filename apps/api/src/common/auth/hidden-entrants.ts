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
import { isPublicEvent } from './event-read-gate';

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
 * The profiles among these the public may know of (rulings 171b, 173-177): one that stands on its
 * own — claimed by an account, or made outside a roster (a super admin's) — whatever its entries
 * (ruling 176: hiding it once a draft entry appears would flip a public page to a 404, and the
 * flip tells of the draft); one that referees or teaches at an Event the public can see, whatever
 * its entries (ruling 177: added from the profile, it has no roster row there); one with no roster
 * row at all; or one with a roster row `knownRosterRows` lets `THE_PUBLIC` know of. A profile known
 * only through entries hidden from the public — a draft Tournament, a draft or test Event — is not,
 * whatever HEMA Ratings id its entry copied onto it (176a). For what spans many Events (ruling
 * 163). A failed read is a 5xx: read as "no roster row", every profile would be known.
 */
export async function publiclyKnownProfileIds(
  deps: Pick<EventAuthzDeps, 'supabase'>,
  profileIds: string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const standing = await rows(
    'profile',
    deps.supabase.service
      .from('global_persons')
      .select('id')
      .in('id', profileIds)
      .or('claimed_by_user_id.not.is.null,made_outside_roster.is.true'),
  );
  const onItsOwn = new Set(standing.map((row) => row.id as string));
  const unsure = profileIds.filter((id) => !onItsOwn.has(id));
  const staff = await publicStaffIds(deps.supabase.service, unsure);
  const rest = unsure.filter((id) => !staff.has(id));
  if (rest.length === 0) return new Set([...onItsOwn, ...staff]);
  const persons = await rows(
    'profile roster',
    deps.supabase.service
      .from('persons')
      .select('id, event_id, global_person_id')
      .in('global_person_id', rest),
  );
  const roster = persons.map((row) => ({
    id: row.id as string,
    eventId: row.event_id as string,
    profileId: row.global_person_id as string,
  }));
  const publicDeps = { supabase: deps.supabase, orgs: NO_CLUB };
  const known = new Set(
    (await knownRosterRows(publicDeps, roster, THE_PUBLIC)).map((row) => row.profileId),
  );
  // A profile that stands on its own or is public staff had its roster rows left unread: it is not
  // `listed`, so kept.
  const listed = new Set(roster.map((row) => row.profileId));
  return new Set(profileIds.filter((id) => !listed.has(id) || known.has(id)));
}

/**
 * The club list `THE_PUBLIC` is read against. The public is a member of no club, and `isInsider`
 * answers an anonymous reader before it would ask: a question here is a bug, so it says so loudly.
 */
const NO_CLUB = {
  assertOrgRole: () => {
    throw new Error('the public is asked no club membership');
  },
} as unknown as EventAuthzDeps['orgs'];

/** The longest read of `firstPubliclyKnown`: it bounds the reads and keeps the `.in()` list short. */
const MAX_PROFILE_READ = 100;

/**
 * The first `want` profiles of a read that the public may know of (`publiclyKnownProfileIds`), so
 * hidden ones never crowd out the rest (rulings 171b, 174): it reads `want` rows, then `want` + the
 * hidden count, until `want` are kept, the rows run out or 100 rows were read — then it answers
 * what it has checked, never a row it has not. Each read is checked whole, so its order never
 * decides what is shown; an order that ends on the id keeps a longer read starting with the
 * shorter one, so the rows kept stay the same.
 */
export async function firstPubliclyKnown<Profile extends { id: string }>(
  deps: Pick<EventAuthzDeps, 'supabase'>,
  want: number,
  read: (limit: number) => Promise<Profile[]>,
): Promise<Profile[]> {
  let limit = want;
  for (;;) {
    const rows = await read(limit);
    const known = await publiclyKnownProfileIds(
      deps,
      rows.map((row) => row.id),
    );
    const kept = rows.filter((row) => known.has(row.id));
    // While fewer than `want` are kept, hidden > limit - want: the next read is longer.
    if (kept.length >= want || rows.length < limit || limit >= MAX_PROFILE_READ) {
      // No more than `want` are kept, unless a row changes between two reads.
      return kept.slice(0, want);
    }
    limit = Math.min(want + rows.length - kept.length, MAX_PROFILE_READ);
  }
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

/**
 * The profiles among these that referee or teach at an Event the public can see (`isPublicEvent`,
 * ruling 177), at any Event: both tables key on the profile id.
 */
async function publicStaffIds(db: SupabaseClient, profileIds: string[]): Promise<Set<string>> {
  const staff = new Set<string>();
  if (profileIds.length === 0) return staff;
  for (const table of ['event_referees', 'event_instructors']) {
    const found = (await rows(
      `profile ${table.replace('_', ' ')}`,
      db.from(table).select('person_id, events(status, event_kind)').in('person_id', profileIds),
    )) as unknown as Array<{ person_id: string; events: Parameters<typeof isPublicEvent>[0] }>;
    for (const row of found) if (isPublicEvent(row.events)) staff.add(row.person_id);
  }
  return staff;
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
