import type { SupabaseClient } from '@supabase/supabase-js';
import { assertRowsBelongToEvent } from '../events/in-event';

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
 * The check itself is `assertRowsBelongToEvent`, shared with Tournaments and
 * Workshops.
 */
export function assertLicesBelongToEvent(
  db: SupabaseClient,
  eventId: string,
  liceIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertRowsBelongToEvent(db, 'lices', 'Lice', eventId, liceIds);
}
