import type { SupabaseService } from '../supabase/supabase.service';

type Database = SupabaseService['service'];

/**
 * The sequence the next row of a bout's timeline takes: the last one plus one. The one owner of
 * that count; `UNIQUE(match_id, sequence)` refuses a second row at it.
 *
 * A failed read is an error. Read as "no row yet", it gave sequence 1, whose insert then failed
 * on the unique key under a message about a duplicate, or was asked again as a collision.
 *
 * A late press reads it BEFORE the reads that judge it (S11): a row another device writes after
 * those reads then takes this sequence first, the late insert collides, and every rule is asked
 * again with that row in sight.
 */
export async function nextSequence(db: Database, matchId: string): Promise<number> {
  const { data, error } = await db
    .from('match_events')
    .select('sequence')
    .eq('match_id', matchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the timeline of bout ${matchId}: ${error.message}`);
  return ((data as { sequence: number } | null)?.sequence ?? 0) + 1;
}
