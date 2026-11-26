import type { McpCaller, McpRefusal, McpToolDeps } from '../mcp-server';
import { readableEventBySlug } from './readable-event';

export interface EventInfoAnswer {
  name: string;
  slug: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
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
  if (!event) return { refusal: `No Event "${eventSlug}" that you can see.` };

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
