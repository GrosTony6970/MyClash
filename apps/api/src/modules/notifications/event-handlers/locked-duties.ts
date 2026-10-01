import { isLive } from '../../../common/live-status';
import type { SupabaseService } from '../../supabase/supabase.service';

type Row = Record<string, unknown> | null;

/** A to-one embed, as PostgREST hands it: an object or a one-element array. */
const one = (value: unknown): Row =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as Row;

/** The phase of a Pool's or a bout's duty, with its Tournament; a piste's has none. */
const phaseOf = (duty: Row): Row =>
  one(one(duty?.['pools'])?.['phases']) ?? one(one(duty?.['matches'])?.['phases']);

/**
 * The locked duties whose lock message goes out again (ruling 186): the send gate dropped it while
 * the duty was a draft's. For a Tournament going live: its duties. For an Event going live: its
 * piste duties and those of a Tournament that is live; one that is completed is over, so its
 * referees are told nothing (ruling 193). A failed read is a plain Error.
 */
export async function lockedDutyIds(
  supabase: SupabaseService,
  eventId: string,
  tournamentId: string | null,
): Promise<string[]> {
  const { data, error } = await supabase.service
    .from('referee_assignments')
    // One plain string: the schema conformance scan does not read a template.
    .select(
      'id, pools(phases(tournament_id, tournaments(status))), matches(phases(tournament_id, tournaments(status)))',
    )
    .eq('event_id', eventId)
    .eq('status', 'confirmed');
  if (error) throw new Error(`locked duties read failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((duty) => {
      const phase = phaseOf(duty);
      if (tournamentId !== null) return phase?.['tournament_id'] === tournamentId;
      return !phase || isLive(one(phase['tournaments'])?.['status']);
    })
    .map((duty) => duty['id'] as string);
}
