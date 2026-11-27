import {
  canReadEvent,
  canReadTournament,
  type CompetitionEvent,
} from '../../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../../common/auth/event-authz';
import type { McpCaller } from '../mcp-server';
import type { McpRefusal } from './mcp-answer';

/**
 * An Event as a tool sees it. The `id` is for service calls inside the tool; it never reaches the
 * tool's output (no tool shows a raw id).
 */
export interface McpEvent {
  id: string;
  name: string;
  slug: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  timezone: string;
  city: string | null;
  country: string | null;
}

/** The one sentence for an unknown Event and a hidden one alike: it must not reveal a draft. */
export function noEventRefusal(slug: string): McpRefusal {
  return { refusal: `No Event "${slug}" that you can see.` };
}

/** The one sentence for an unknown Tournament and a hidden one alike, at a readable Event. */
export function noTournamentRefusal(slug: string, event: McpEvent): McpRefusal {
  return { refusal: `No Tournament "${slug}" at ${event.name} that you can see.` };
}

interface EventRow extends CompetitionEvent {
  name: string;
  slug: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  city: string | null;
  country: string | null;
}

/**
 * The Event a person names by slug, when the person may see it. An unknown slug and a hidden
 * Event (a draft or test one the person is not a member of) both answer `null`, so the answer
 * cannot reveal a draft. A failed read throws: it is not "unknown".
 *
 * It applies the gate the public Event page applies (`canReadEvent`), with the connector's person
 * as the reader. It does not call `readableEvent`, which takes an id and answers a hidden Event
 * with a 404 exception: a tool wants the slug's row and a plain null.
 */
export async function readableEventBySlug(
  slug: string,
  caller: McpCaller,
  deps: EventAuthzDeps,
): Promise<McpEvent | null> {
  const { data, error } = await deps.supabase.service
    .from('events')
    .select(
      'id, name, slug, start_date, end_date, status, timezone, city, country, organization_id, event_kind',
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`event read failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as EventRow;
  if (!(await canReadEvent(deps, row, { userId: caller.userId, staff: null }))) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    timezone: row.timezone,
    city: row.city,
    country: row.country,
  };
}

/**
 * The id of the Tournament a call names, with its Event, or the refusal for it. The Event goes
 * through the public Event gate (call C11), then the Tournament through the public Tournament
 * gate, before any setting is read: a hidden (draft) Tournament is unknown to a non-insider,
 * whatever the setting admits, and its name is not said.
 */
export async function readableTournamentId(
  eventSlug: string,
  tournamentSlug: string,
  caller: McpCaller,
  deps: EventAuthzDeps,
): Promise<{ event: McpEvent; tournamentId: string } | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return noEventRefusal(eventSlug);
  return readableTournamentIn(event, tournamentSlug, caller, deps);
}

/**
 * `readableTournamentId` for an Event the tool has already read through the Event gate: the
 * Tournament by slug inside it, then the public Tournament gate.
 */
export async function readableTournamentIn(
  event: McpEvent,
  tournamentSlug: string,
  caller: McpCaller,
  deps: EventAuthzDeps,
): Promise<{ event: McpEvent; tournamentId: string } | McpRefusal> {
  const tournamentId = await tournamentIdBySlug(deps, event.id, tournamentSlug);
  if (!tournamentId) return noTournamentRefusal(tournamentSlug, event);
  const reader = { userId: caller.userId, staff: null };
  if (!(await canReadTournament(deps, tournamentId, reader))) {
    return noTournamentRefusal(tournamentSlug, event);
  }
  return { event, tournamentId };
}

/**
 * The id of the Event's Tournament with this slug, hidden or not, or null. A slug is unique in
 * its Event (`UNIQUE(event_id, slug)`). A failed read throws: it is not "no such Tournament".
 */
export async function tournamentIdBySlug(
  deps: Pick<EventAuthzDeps, 'supabase'>,
  eventId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select('id')
    .eq('event_id', eventId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`tournament read failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
