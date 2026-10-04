/**
 * Where a reviewer reads the bout a correction request names: the bout's page
 * in the organiser app, with its sheet and its audit trail.
 *
 * That address needs the club's slug, which a request does not carry. One read
 * for the Events of a whole list. A failed read gives no link and a warning: a
 * queue with no links is still a queue.
 */
import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

type Organization = { slug: string | null };
type EventRow = { id: string; organizations: Organization | Organization[] | null };

export interface BoutLinkDeps {
  supabase: SupabaseService;
  logger: Logger;
}

/** The link of each request's bout, by request id. A request with no link is absent. */
export async function boutLinks(
  deps: BoutLinkDeps,
  requests: ReadonlyArray<{ id: string; event_id: string; match_id: string }>,
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const eventIds = [...new Set(requests.map((request) => request.event_id))];
  if (eventIds.length === 0) return links;

  const { data, error } = await deps.supabase.service
    .from('events')
    .select('id, organizations!inner(slug)')
    .in('id', eventIds);
  if (error) {
    deps.logger.warn(`No bout links for the correction requests: ${error.message}`);
    return links;
  }

  const slugs = new Map<string, string>();
  for (const event of (data ?? []) as unknown as EventRow[]) {
    // The typed client reads a to-one embed as an array.
    const organization = Array.isArray(event.organizations)
      ? event.organizations[0]
      : event.organizations;
    if (organization?.slug) slugs.set(event.id, organization.slug);
  }
  for (const request of requests) {
    const slug = slugs.get(request.event_id);
    if (slug) {
      links.set(request.id, `/org/${slug}/events/${request.event_id}/matches/${request.match_id}`);
    }
  }
  return links;
}
