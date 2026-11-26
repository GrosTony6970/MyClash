import type { McpCaller, McpToolDeps } from '../mcp-server';
import type { McpRefusal } from './mcp-answer';
import { noEventRefusal, readableEventBySlug } from './readable-event';

export interface EventInfoAnswer {
  name: string;
  slug: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  /** The Event's own IANA zone; its dates and times are read on that clock. */
  timezone: string;
  city: string | null;
  country: string | null;
  tournaments: { name: string; slug: string; weapon: string | null; status: string }[];
}

/** The Tournament row fields this tool shows; `listTournaments` carries many more. */
interface ListedTournament {
  name: string;
  slug: string;
  weapon: string | null;
  status: string;
}

/**
 * An Event's public front page: its dates, place and the Tournaments the person may see. The
 * Tournament list is the one the public Event page shows, so a draft Tournament is left out.
 */
export async function eventInfo(
  eventSlug: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<EventInfoAnswer | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return noEventRefusal(eventSlug);

  const rows = (await deps.events.listTournaments(event.id, {
    userId: caller.userId,
    staff: null,
  })) as unknown as ListedTournament[];
  return {
    name: event.name,
    slug: event.slug,
    startDate: event.startDate,
    endDate: event.endDate,
    status: event.status,
    timezone: event.timezone,
    city: event.city,
    country: event.country,
    tournaments: rows.map((t) => ({
      name: t.name,
      slug: t.slug,
      weapon: t.weapon ?? null,
      status: t.status,
    })),
  };
}
