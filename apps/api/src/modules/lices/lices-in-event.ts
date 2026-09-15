import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Refuse any Lice that is not one of this Event's.
 *
 * A Lice belongs to exactly one Event (`lices.event_id` is required). A Match or
 * a Pool placed on another Event's Lice counts as an occupant there, blocks that
 * Event's own placements, and shows on its live board. Migration 0197 refuses
 * such a write in the database, under every writer. This refuses first, with a
 * message an organiser can read, and before a write of several rows can
 * half-apply. Every door that takes a Lice id from its caller calls it. Generate,
 * the venue move and Swiss rounds choose from the Event's own Lices and need no
 * call.
 *
 * A `null` is skipped: clearing a Lice needs no check. A repeated id counts once.
 */
export async function assertLicesBelongToEvent(
  db: SupabaseClient,
  eventId: string,
  liceIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(liceIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return;
  const { data, error } = await db.from('lices').select('id').eq('event_id', eventId).in('id', ids);
  if (error) throw new BadRequestException(error.message);
  if ((data ?? []).length !== ids.length) {
    throw new BadRequestException('Every Lice must belong to this event');
  }
}
