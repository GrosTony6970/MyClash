import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = new Logger('ExistingPhase');

/**
 * The Tournament's phase of one of `types` (`['pool']`, or both elimination types), or null.
 *
 * The one read of "does this Tournament have Pools (or a bracket) yet". Generate Pools and
 * Generate Bracket refuse on it without `force`, and Claude's draft tools refuse on it before
 * they save a draft that Apply would refuse.
 *
 * A failed read answers null, as both doors have always read it: they go on and generate. That
 * is kept as it was, with a warning in the log so the miss leaves a trace.
 */
export async function existingPhase(
  db: SupabaseClient,
  tournamentId: string,
  types: readonly string[],
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('phases')
    .select('id')
    .eq('tournament_id', tournamentId)
    .in('type', [...types])
    .maybeSingle();
  if (error) {
    logger.warn(`existing phase read failed, read as none: ${error.message}`);
    return null;
  }
  return (data as { id: string } | null) ?? null;
}
