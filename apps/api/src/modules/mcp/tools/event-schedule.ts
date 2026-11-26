import { zonedDay } from '@myclash/time';
import type { ScheduleGridMatch } from '../../schedule/schedule-grid-match';
import type { McpCaller, McpRefusal, McpToolDeps } from '../mcp-server';
import { noEventRefusal, noTournamentRefusal, readableEventBySlug } from './readable-event';

/** How many bouts a call answers when the model names no `limit`. The bounds live in the schema. */
export const EVENT_SCHEDULE_DEFAULT_LIMIT = 20;

export interface EventScheduleArgs {
  tournament?: string;
  /** `YYYY-MM-DD`, a day of the Event in its own time zone. */
  day?: string;
  limit?: number;
}

export interface EventScheduleAnswer {
  /** The Event's own IANA zone: `day` is read on its clock, and `start` is UTC. */
  timezone: string;
  /** How many bouts matched the filters, before the cap. */
  total: number;
  fights: {
    start: string | null;
    liceName: string | null;
    tournamentName: string | null;
    tournamentSlug: string | null;
    roundCode: string;
    red: string | null;
    blue: string | null;
    status: string;
  }[];
}

/** Lice id to name, for this Event. A failed read throws: a bout must not lose its lice silently. */
async function liceNames(eventId: string, deps: McpToolDeps): Promise<Map<string, string>> {
  const { data, error } = await deps.supabase.service
    .from('lices')
    .select('id, name')
    .eq('event_id', eventId);
  if (error) throw new Error(`lices read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as { id: string; name: string }[];
  return new Map(rows.map((l) => [l.id, l.name] as const));
}

/** Soonest first; a bout with no start has no day and goes last. */
function byStart(a: ScheduleGridMatch, b: ScheduleGridMatch): number {
  if (a.scheduledAt === b.scheduledAt) return 0;
  if (a.scheduledAt === null) return 1;
  if (b.scheduledAt === null) return -1;
  return Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
}

/**
 * The Event's public bouts: what the public schedule page shows. `day` is a calendar day of the
 * Event in its own time zone (a late-evening UTC bout can be the next day there); a bout with no
 * start has no day, so a `day` filter leaves it out.
 */
export async function eventSchedule(
  eventSlug: string,
  args: EventScheduleArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<EventScheduleAnswer | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return noEventRefusal(eventSlug);

  const reader = { userId: caller.userId, staff: null };
  // A Tournament slug the person cannot see (unknown, or hidden: `listTournaments` leaves those
  // out) is refused. The check is the Tournament list, not the grid: a visible Tournament with no
  // bout yet is empty, not unknown.
  if (args.tournament) {
    const visible = (await deps.events.listTournaments(event.id, reader)) as unknown as {
      slug: string;
    }[];
    if (!visible.some((t) => t.slug === args.tournament)) {
      return noTournamentRefusal(args.tournament, event);
    }
  }
  const grid = await deps.scheduleGrid.listEventSchedule(event.id, reader);
  const lices = await liceNames(event.id, deps);

  const matched = grid
    .filter((m) => !args.tournament || m.tournamentSlug === args.tournament)
    .filter(
      (m) =>
        !args.day ||
        (m.scheduledAt !== null && zonedDay(m.scheduledAt, event.timezone) === args.day),
    )
    .sort(byStart);

  return {
    timezone: event.timezone,
    total: matched.length,
    fights: matched.slice(0, args.limit ?? EVENT_SCHEDULE_DEFAULT_LIMIT).map((m) => ({
      start: m.scheduledAt,
      liceName: m.liceId ? (lices.get(m.liceId) ?? null) : null,
      tournamentName: m.tournamentName,
      tournamentSlug: m.tournamentSlug,
      roundCode: m.roundCode,
      red: m.redFighterName,
      blue: m.blueFighterName,
      status: m.status,
    })),
  };
}
