import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = new Logger('ExistingPhase');

/**
 * The Tournament's phase of one of `types` (`['pool']`, or both elimination types), or null.
 *
 * The one read of "does this Tournament have Pools (or a bracket) yet". Generate Pools, Generate
 * Bracket and Add Pool create the phase when it answers none, and Claude's draft tools refuse on
 * it before they save a draft that Apply would refuse.
 *
 * A failed read THROWS (a 5xx), with a warning in the log. Read as "none", a database blip made
 * Generate Pools write a second Pool phase beside the first: `phases` has no unique index on
 * (Tournament, type), and from then on every one-row read of the Pool phase failed on two rows,
 * read as "none" again, and the app could not repair it.
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
    logger.warn(`existing phase read failed: ${error.message}`);
    throw new Error(`existing phase read failed: ${error.message}`);
  }
  return (data as { id: string } | null) ?? null;
}
