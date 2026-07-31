import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { parseSwissConfig, type SwissConfig } from './dto/swiss-config.dto';

/**
 * Read and write `phases.config_json` for a Swiss phase.
 *
 * One accessor pair so the two services that own parts of the lifecycle
 * (SwissService for generation and configuration, SwissFinaliseService for
 * freezing) cannot drift on how the blob is read or how a failed write is
 * detected.
 */

/**
 * Write the whole config back.
 *
 * Fail-loud: `select().maybeSingle()` returning null means the WHERE matched no
 * row, which is a 404 rather than a success. An update that silently persists
 * nothing is the failure mode that let manual-assign PATCHes return 200 with no
 * row written.
 */
export async function writeSwissConfig(
  supabase: SupabaseService,
  phaseId: string,
  config: SwissConfig,
): Promise<void> {
  const { data, error } = await supabase.service
    .from('phases')
    .update({ config_json: config })
    .eq('id', phaseId)
    .select('id')
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Phase ${phaseId} not found`);
}

/** Re-read a phase's config. Null when the phase is gone or misconfigured. */
export async function readSwissConfig(
  supabase: SupabaseService,
  phaseId: string,
): Promise<SwissConfig | null> {
  const { data } = await supabase.service
    .from('phases')
    .select('config_json')
    .eq('id', phaseId)
    .maybeSingle();
  return parseSwissConfig((data as { config_json?: unknown } | null)?.config_json);
}

/**
 * Does this tournament have a bracket seeded from the given Swiss phase with a
 * bout already under way?
 *
 * The question `unfinalise` has to answer before it will resume: that bracket's
 * round 1 IS this phase's final ranking, so changing the ranking underneath a
 * tournament already being fought is not recoverable.
 */
export async function hasStartedDownstreamBracket(
  supabase: SupabaseService,
  tournamentId: string,
  swissPhaseId: string,
): Promise<boolean> {
  const { data: phases } = await supabase.service
    .from('phases')
    .select('id, type, config_json')
    .eq('tournament_id', tournamentId)
    .in('type', ['single_elim', 'double_elim']);

  for (const row of (phases ?? []) as Array<Record<string, unknown>>) {
    const config = (row['config_json'] ?? {}) as Record<string, unknown>;
    const seededFromSwiss =
      config['seedingStrategy'] === 'by-swiss-rank' || config['sourcePhaseId'] === swissPhaseId;
    if (!seededFromSwiss) continue;

    const { data: started } = await supabase.service
      .from('matches')
      .select('id')
      .eq('phase_id', row['id'] as string)
      .neq('status', 'scheduled')
      .limit(1);
    if (((started ?? []) as unknown[]).length > 0) return true;
  }
  return false;
}
