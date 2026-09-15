import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SuggestConfig } from '@myclash/types';
import { storedProgrammeConfigSchema } from './dto/programme.dto';

/**
 * The Event's planner sheet, read for planning (ADR-018). The planner's GET,
 * Generate, the re-fan and the staff live board all call this, so they cannot
 * load it two ways.
 *
 * No row reads as the schema's defaults, and a stored sheet missing a field is
 * filled by them, because what is loaded goes through the schema. A field the
 * schema dropped is ignored; a value it refuses is a server fault and surfaces
 * as one.
 *
 * No authorization here: each caller decides who may read, before calling.
 */
export async function readProgrammeSheet(
  db: SupabaseClient,
  eventId: string,
): Promise<SuggestConfig> {
  const { data, error } = await db
    .from('event_programme_configs')
    .select('config_json')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const row = data as { config_json: unknown } | null;
  return storedProgrammeConfigSchema.parse(row?.config_json ?? {});
}
