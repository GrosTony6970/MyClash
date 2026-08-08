import { BadRequestException } from '@nestjs/common';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import type { SupabaseService } from '../supabase/supabase.service';
import type { RosterPersonRow } from './roster';

/**
 * The roster as an event-day desk sees it — shared by check-in and gear check.
 *
 * One owner because both desks answer the same question first ("who is this
 * person in front of me?") and must answer it identically: the photo and club
 * that let a volunteer tell two similar names apart are worth nothing if the
 * two screens resolve them differently.
 */

/** The desk types three letters and expects to see the name. */
export const ROSTER_LIMIT = 40;

/** Below two characters a name search matches most of the roster; the API ignores it. */
const MIN_QUERY_LENGTH = 2;

export async function queryEventRoster(
  supabase: SupabaseService,
  eventId: string,
  q: string | undefined,
  limit = ROSTER_LIMIT,
): Promise<RosterPersonRow[]> {
  let query = supabase.service
    .from('persons')
    .select(
      'id,given_name,family_name,club_id,global_person_id,clubs(name,logo_url),global_persons(photo_url)',
    )
    .eq('event_id', eventId)
    .order('family_name', { ascending: true })
    .limit(limit);

  const safe = q ? sanitizePostgrestFilterValue(q) : '';
  // Commas and parens would break out of the `or` grammar, so the sanitizer
  // strips them; an all-punctuation query sanitizes to '' and is treated as no
  // filter rather than as a match-nothing.
  if (safe.length >= MIN_QUERY_LENGTH) {
    query = query.or(
      `given_name.ilike.%${safe}%,family_name.ilike.%${safe}%`,
    ) as unknown as typeof query;
  }

  const { data, error } = await query;
  if (error) throw new BadRequestException(error.message);
  return (data ?? []) as unknown as RosterPersonRow[];
}
