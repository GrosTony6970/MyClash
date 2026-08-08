import { NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';

/**
 * "Events are addressed by slug OR id" — the one implementation.
 *
 * Public URLs are `/e/<slug>/...`, so every client under that tree naturally
 * sends a slug. Several API routes already accept both by carrying their own
 * copy of this regex and their own resolve step (`live-state.service.ts`,
 * `events.service.ts`, `fighters.service.ts`, `entity-label.service.ts`), which
 * is how `my-schedule` came to declare `@Param('eventId', ParseUUIDPipe)` while
 * every caller sent a slug: the route 400'd, the page's `res.ok` check swallowed
 * it, and the surface rendered its logged-out empty state instead of a schedule.
 *
 * A route that takes an event reference from a public URL should call this
 * rather than pipe the param, so the next one cannot make the same choice.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEventUuid(ref: string): boolean {
  return UUID_RE.test(ref);
}

/**
 * Resolve a slug-or-id to an event id.
 *
 * A UUID is returned unverified — every caller goes on to query something
 * scoped by it, so a non-existent id yields an empty result there rather than an
 * extra round trip here. A slug has to be looked up, and a slug that matches
 * nothing is a 404: the caller asked for a named event that does not exist.
 *
 * Deliberately does NOT apply the public-visibility rule that
 * `getEventBySlug` applies. That rule belongs to the public event page; a
 * participant holding a guest session for a test event still has a schedule and
 * still has a pass.
 */
export async function resolveEventId(supabase: SupabaseService, ref: string): Promise<string> {
  if (isEventUuid(ref)) return ref;

  const { data } = await supabase.service.from('events').select('id').eq('slug', ref).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new NotFoundException(`Event "${ref}" not found`);
  return id;
}
