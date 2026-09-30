import type { SupabaseService } from '../../supabase/supabase.service';

type Row = Record<string, unknown> | null;

/** A to-one embed, as PostgREST hands it: an object or a one-element array. */
const one = (value: unknown): Row =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as Row;

/** The Tournament of a Pool's or a bout's duty; a piste's has none. */
const tournamentOf = (duty: Row): unknown =>
  one(one(duty?.['pools'])?.['phases'])?.['tournament_id'] ??
  one(one(duty?.['matches'])?.['phases'])?.['tournament_id'];

/**
 * The locked duties of an Event, or of one of its Tournaments (ruling 186): the ones whose lock
 * message the send gate dropped while they were a draft's, to send once it is published. A failed
 * read is a plain Error.
 */
export async function lockedDutyIds(
  supabase: SupabaseService,
  eventId: string,
  tournamentId: string | null,
): Promise<string[]> {
  const { data, error } = await supabase.service
    .from('referee_assignments')
    .select('id, pools(phases(tournament_id)), matches(phases(tournament_id))')
    .eq('event_id', eventId)
    .eq('status', 'confirmed');
  if (error) throw new Error(`locked duties read failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((duty) => tournamentId === null || tournamentOf(duty) === tournamentId)
    .map((duty) => duty['id'] as string);
}
