import { inListChunks } from '../common/postgrest-in-list';
import type { SupabaseService } from '../modules/supabase/supabase.service';

/**
 * The HEMA Ratings ids the nightly sync fetches ratings for: every id on a
 * global profile, and every id typed on a roster row of an Event that has not
 * ended (operator ruling 41, 2026-09-22). Trimmed, once each.
 *
 * An entry no longer copies the typed id onto the profile (ruling 35) and the
 * Event's readers take the roster row's id first (ruling 39), so without the
 * roster ids that rating would be gone after one night. A finished Event seeds
 * nothing, so its roster is not fetched.
 */
export async function linkedHemaRatingsIds(supabase: SupabaseService): Promise<string[]> {
  const { data: profiles, error } = await supabase.service
    .from('global_persons')
    .select('hema_ratings_id')
    .not('hema_ratings_id', 'is', null);
  if (error) throw new Error(`Failed to load linked HEMA Ratings IDs: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error: eventsError } = await supabase.service
    .from('events')
    .select('id')
    .gte('end_date', today);
  if (eventsError) throw new Error(`Failed to load current Events: ${eventsError.message}`);

  const rows = [...((profiles ?? []) as Array<{ hema_ratings_id: string | null }>)];
  const eventIds = ((events ?? []) as Array<{ id: string }>).map((event) => event.id);
  for (const chunk of inListChunks(eventIds)) {
    const { data: roster, error: rosterError } = await supabase.service
      .from('persons')
      .select('hema_ratings_id')
      .in('event_id', chunk)
      .not('hema_ratings_id', 'is', null);
    if (rosterError) {
      throw new Error(`Failed to load roster HEMA Ratings IDs: ${rosterError.message}`);
    }
    rows.push(...((roster ?? []) as Array<{ hema_ratings_id: string | null }>));
  }

  return Array.from(
    new Set(
      rows.map((row) => row.hema_ratings_id?.trim()).filter((id): id is string => Boolean(id)),
    ),
  );
}
