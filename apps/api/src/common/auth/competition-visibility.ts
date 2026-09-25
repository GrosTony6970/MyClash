/**
 * Who may see a Tournament's public contents: its bouts, scores, standings and
 * stats (operator rulings 81-83, 89).
 *
 * Hidden: a DRAFT or TEST Event (`isPublicEvent`, rulings 97, 101), or a
 * Tournament that is not published, running or completed — the rule the
 * public slug pages already apply
 * (`events.service.ts`, `getPublicTournamentStandings`). A hidden one is still
 * seen by any member of the Event's club and by an ACTIVE staff session of the
 * same Event: a scoring tablet on a test day before the Event is announced is
 * not a club member (ruling 81). A hall projector with no login sees nothing
 * hidden; signed in as a member, it does (ruling 89).
 *
 * The check answers a boolean, not a refusal. Each route answers a hidden row
 * exactly as it answers an unknown id — an empty list stays empty, a 404 keeps
 * its wording (ruling 83) — so the difference cannot reveal a draft.
 */
import { ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type EventAuthzDeps } from './event-authz';
import { isPublicEvent } from './event-read-gate';
import { getIdentity, getStaffSession, type StaffSession } from './identity';
import { ANONYMOUS_USER_ID } from './request-user';

/** The Tournament statuses the public slug pages show. */
export const PUBLIC_TOURNAMENT_STATUSES = new Set(['published', 'running', 'completed']);

/** The caller of a public read, as the AuthGuard resolved it. */
export interface PublicReader {
  /** Verified locally by the guard: no GoTrue round-trip, so no outage turns a member away. */
  userId: string;
  /**
   * The request's verified staff cookie, if any; still checked for `active`.
   * Read beside the login, not instead of it: a pad where a stranger once
   * signed in still carries its Event's staff session (ruling 81).
   */
  staff: StaffSession | null;
}

export function publicReader(req: FastifyRequest): PublicReader {
  const identity = getIdentity(req);
  return {
    userId: identity.kind === 'claimed' ? identity.userId : ANONYMOUS_USER_ID,
    staff: getStaffSession(req),
  };
}

export interface CompetitionEvent {
  id: string;
  status: string;
  organization_id: string;
  /** Required: a read without it counts as a standard Event (fail-visible). */
  event_kind: string | null;
}

export interface CompetitionRow {
  tournamentStatus: string;
  event: CompetitionEvent;
}

/** Is anything here hidden from the public: the Event, or one of these Tournaments? */
export function hidesFromPublic(
  event: Pick<CompetitionEvent, 'status' | 'event_kind'>,
  tournamentStatuses: readonly string[],
): boolean {
  return (
    !isPublicEvent(event) ||
    tournamentStatuses.some((status) => !PUBLIC_TOURNAMENT_STATUSES.has(status))
  );
}

export function isHiddenCompetition(row: CompetitionRow): boolean {
  return hidesFromPublic(row.event, [row.tournamentStatus]);
}

/**
 * Does the Event hide anything from the public: is it a DRAFT or TEST Event, or is one of its
 * Tournaments not public? Ask it for an insider only. web-public's live channel
 * is anonymous and RLS keeps those rows off it, so an insider's screen polls
 * instead (ruling 92). It asks the Event, not the bouts on screen: a hidden
 * Tournament's bout can reach any piste at any time, and nothing announces it.
 */
export async function eventHidesFromPublic(
  deps: Pick<EventAuthzDeps, 'supabase'>,
  event: Pick<CompetitionEvent, 'id' | 'status' | 'event_kind'>,
): Promise<boolean> {
  if (!isPublicEvent(event)) return true;
  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select('status')
    .eq('event_id', event.id);
  // A 5xx, not a 400 carrying the database's own words.
  if (error) throw new Error(`tournament status read failed: ${error.message}`);
  const statuses = ((data ?? []) as Array<{ status: string }>).map((row) => row.status);
  return hidesFromPublic(event, statuses);
}

/** A member of the Event's club, any role, or an active staff session of the Event. */
export async function isInsider(
  deps: EventAuthzDeps,
  event: Pick<CompetitionEvent, 'id' | 'organization_id'>,
  reader: PublicReader,
): Promise<boolean> {
  if (reader.staff?.eventId === event.id && (await isActiveStaff(deps, reader.staff))) {
    return true;
  }
  if (reader.userId === ANONYMOUS_USER_ID) return false;
  try {
    await deps.orgs.assertOrgRole(event.organization_id, reader.userId, 'read_only');
    return true;
  } catch (error) {
    // Only a refusal means "not a member"; a failed read stays a 5xx.
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

/** Read on every call, like the staff routes do: a disabled account stops at once. */
async function isActiveStaff(
  deps: EventAuthzDeps,
  staff: { staffId: string; eventId: string },
): Promise<boolean> {
  const { data, error } = await deps.supabase.service
    .from('event_staff_accounts')
    .select('status')
    .eq('id', staff.staffId)
    .eq('event_id', staff.eventId)
    .maybeSingle();
  if (error) throw new Error(`staff session read failed: ${error.message}`);
  return (data as { status?: string } | null)?.status === 'active';
}

/**
 * May the caller see this Event's public contents? A DRAFT or TEST one only an
 * insider may (rulings 97, 101): the public Event page answers a test Event as
 * an unknown one.
 */
export async function canReadEvent(
  deps: EventAuthzDeps,
  event: CompetitionEvent,
  reader: PublicReader,
): Promise<boolean> {
  return isPublicEvent(event) || isInsider(deps, event, reader);
}

/**
 * May the caller see this Tournament's contents (ruling 82)? A hidden one only
 * an insider may. An unknown id is `true`: the route then answers it as it
 * always has, which is what a hidden one must look like (ruling 83).
 */
export async function canReadTournament(
  deps: EventAuthzDeps,
  tournamentId: string,
  reader: PublicReader,
): Promise<boolean> {
  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select('status, events!inner(id, status, organization_id, event_kind)')
    .eq('id', tournamentId)
    .maybeSingle();
  // A 5xx: a failed read is not "unknown", and not the database's words in a 400.
  if (error) throw new Error(`tournament visibility read failed: ${error.message}`);
  const row = data as { status: string; events: CompetitionEvent } | null;
  if (!row || !isHiddenCompetition({ tournamentStatus: row.status, event: row.events })) {
    return true;
  }
  return isInsider(deps, row.events, reader);
}

/** The embed that reaches a bout's Tournament status and Event from `matches`. */
export const MATCH_COMPETITION_SELECT =
  'phases!inner(tournaments!inner(status, events!inner(id, status, organization_id, event_kind)))';

export interface MatchCompetitionEmbed {
  phases?: { tournaments?: { status: string; events: CompetitionEvent } };
}

export function competitionOfMatch(row: MatchCompetitionEmbed | null): CompetitionRow | null {
  const tournament = row?.phases?.tournaments;
  return tournament ? { tournamentStatus: tournament.status, event: tournament.events } : null;
}

/**
 * May the caller see the hidden bouts on this piste? Only an insider of the
 * piste's Event may. A caller with no login and no staff cookie — the hall
 * projector — costs no read.
 */
export async function seesHiddenOnLice(
  deps: EventAuthzDeps,
  liceId: string,
  reader: PublicReader,
): Promise<boolean> {
  if (!reader.staff && reader.userId === ANONYMOUS_USER_ID) return false;
  const { data, error } = await deps.supabase.service
    .from('lices')
    .select('events!inner(id, organization_id)')
    .eq('id', liceId)
    .maybeSingle();
  if (error) throw new Error(`piste read failed: ${error.message}`);
  const event = (data as { events?: Pick<CompetitionEvent, 'id' | 'organization_id'> } | null)
    ?.events;
  return event ? isInsider(deps, event, reader) : false;
}

/**
 * Leave out the bouts an outsider may not see, IN SQL: a list that reads the
 * first n bouts and filters afterwards lets n earlier hidden bouts empty it, and
 * organisers schedule a Tournament before they publish it. The query must embed
 * `phases!inner(… tournaments!inner(… status …))`: PostgREST narrows the bouts
 * through an embed only when every embed on the path is inner. A draft Event is
 * decided before this, from the Event itself.
 */
export function onlyPublicTournaments<
  Query extends { in(column: string, values: string[]): Query },
>(query: Query): Query {
  return query.in('phases.tournaments.status', [...PUBLIC_TOURNAMENT_STATUSES]);
}

/**
 * Must this row be answered to the caller as an unknown one (rulings 81-83)? Hidden from the
 * public, and the caller no insider. The membership read runs only for a hidden row.
 */
export async function hiddenFromReader(
  deps: EventAuthzDeps,
  row: CompetitionRow,
  reader: PublicReader,
): Promise<boolean> {
  return isHiddenCompetition(row) && !(await isInsider(deps, row.event, reader));
}

/**
 * The Tournaments of one Event the caller may see (rulings 81-83, 127a): all of them for an
 * insider, else the published, running and completed ones. A hidden Tournament is simply left
 * out, as if it did not exist. The membership read runs only when something is hidden.
 */
export async function visibleTournaments<Row extends { status: string }>(
  deps: EventAuthzDeps,
  event: CompetitionEvent,
  rows: Row[],
  reader: PublicReader,
): Promise<Row[]> {
  const statuses = rows.map((row) => row.status);
  if (!hidesFromPublic(event, statuses) || (await isInsider(deps, event, reader))) return rows;
  return rows.filter((row) => !isHiddenCompetition({ tournamentStatus: row.status, event }));
}

/**
 * What the caller may know of this bout: `refused` (answer it as an unknown
 * one), `public`, or `hidden` — hidden from the public, shown to this insider.
 * An unknown bout is `public`: the route then answers it as it always has.
 */
export async function matchVisibility(
  deps: EventAuthzDeps,
  matchId: string,
  reader: PublicReader,
): Promise<'refused' | 'public' | 'hidden'> {
  const { data, error } = await deps.supabase.service
    .from('matches')
    .select(MATCH_COMPETITION_SELECT)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`bout read failed: ${error.message}`);
  const row = competitionOfMatch(data as MatchCompetitionEmbed | null);
  if (!row || !isHiddenCompetition(row)) return 'public';
  return (await isInsider(deps, row.event, reader)) ? 'hidden' : 'refused';
}

/** May the caller see this bout? See `matchVisibility`. */
export async function canReadMatch(
  deps: EventAuthzDeps,
  matchId: string,
  reader: PublicReader,
): Promise<boolean> {
  return (await matchVisibility(deps, matchId, reader)) !== 'refused';
}
