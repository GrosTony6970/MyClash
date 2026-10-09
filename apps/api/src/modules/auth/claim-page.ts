import type { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { SupabaseService } from '../supabase/supabase.service';

/** The claim page of a roster row, on the participant site: the one owner of its address. */
export function claimPagePath(eventSlug: string, personId: string): string {
  return `/e/${encodeURIComponent(eventSlug)}/claim?personId=${encodeURIComponent(personId)}`;
}

/**
 * The claim page of the Event a roster row is at, or null: no such row, a row
 * of a draft Event, or a read that failed.
 *
 * For a claim link that signed nobody in (operator ruling 368): its reader goes
 * back to the form that mails a new one, her roster name kept. The read only
 * chooses a page, so a fault sends her to the sign-in page, with a trace.
 *
 * Nobody is signed in, and the page's address names the Event. So a draft
 * Event answers as no row does (operator ruling 375). A test Event keeps its
 * claim page: its testers hold claim mails too, so `isPublicEvent` is not the
 * rule here. `personId` is the caller's own text: one that is no id reaches
 * no read and no log line.
 */
export async function claimPageOf(
  deps: { supabase: SupabaseService; logger: Logger },
  personId: string,
): Promise<string | null> {
  if (!z.uuid().safeParse(personId).success) return null;
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('events(slug, status)')
    .eq('id', personId)
    .maybeSingle();
  if (error) {
    deps.logger.warn(`The claim page of person ${personId} was not read: ${error.message}`);
    return null;
  }
  const event = (data as { events: { slug?: string; status?: string } | null } | null)?.events;
  return event?.slug && event.status !== 'draft' ? claimPagePath(event.slug, personId) : null;
}
