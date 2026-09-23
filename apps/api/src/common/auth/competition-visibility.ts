/**
 * Who may see a Tournament's public contents: its bouts, scores, standings and
 * stats (operator rulings 81-83, 89).
 *
 * Hidden: a DRAFT Event, or a Tournament that is not published, running or
 * completed — the rule the public slug pages already apply
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
import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { HIDDEN_EVENT_STATUSES, type EventAuthzDeps } from './event-authz';
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
}

export interface CompetitionRow {
  tournamentStatus: string;
  event: CompetitionEvent;
}

export function isHiddenCompetition(row: CompetitionRow): boolean {
  return (
    HIDDEN_EVENT_STATUSES.has(row.event.status) ||
    !PUBLIC_TOURNAMENT_STATUSES.has(row.tournamentStatus)
  );
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
  } catch {
    return false;
  }
}

export async function canReadCompetition(
  deps: EventAuthzDeps,
  row: CompetitionRow,
  reader: PublicReader,
): Promise<boolean> {
  return !isHiddenCompetition(row) || isInsider(deps, row.event, reader);
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
  if (error) throw new BadRequestException(error.message);
  return (data as { status?: string } | null)?.status === 'active';
}

/** The embed that reaches a bout's Tournament status and Event from `matches`. */
export const MATCH_COMPETITION_SELECT =
  'phases!inner(tournaments!inner(status, events!inner(id, status, organization_id)))';

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
  if (error) throw new BadRequestException(error.message);
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
 * May the caller see this bout? An unknown bout answers true: the route then
 * answers it as it always has.
 */
export async function canReadMatch(
  deps: EventAuthzDeps,
  matchId: string,
  reader: PublicReader,
): Promise<boolean> {
  const { data, error } = await deps.supabase.service
    .from('matches')
    .select(MATCH_COMPETITION_SELECT)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const row = competitionOfMatch(data as MatchCompetitionEmbed | null);
  return row ? canReadCompetition(deps, row, reader) : true;
}
