import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

/** The claim page of a roster row, on the participant site: the one owner of its address. */
export function claimPagePath(eventSlug: string, personId: string): string {
  return `/e/${encodeURIComponent(eventSlug)}/claim?personId=${encodeURIComponent(personId)}`;
}

/**
 * The claim page of the Event a roster row is at, or null: no such row, or a
 * read that failed.
 *
 * For a claim link that signed nobody in (operator ruling 368): its reader goes
 * back to the form that mails a new one, her roster name kept. The read only
 * chooses a page, so a fault sends her to the sign-in page, with a trace.
 */
export async function claimPageOf(
  deps: { supabase: SupabaseService; logger: Logger },
  personId: string,
): Promise<string | null> {
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('events(slug)')
    .eq('id', personId)
    .maybeSingle();
  if (error) {
    deps.logger.warn(`The claim page of person ${personId} was not read: ${error.message}`);
    return null;
  }
  const slug = (data as { events: { slug?: string } | null } | null)?.events?.slug;
  return slug ? claimPagePath(slug, personId) : null;
}
