import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The Event-owned tables a caller may name by id. Each carries a required `event_id`. */
type EventOwnedTable = 'lices' | 'tournaments' | 'workshops';

/**
 * Refuse any id of `table` that is not one of this Event's.
 *
 * The one owner of the check. A route takes an id from its caller and writes it
 * next to this Event's rows; the service-role client bypasses RLS, and a foreign
 * key names the table, never the Event, so nothing else refuses another Event's
 * row. Called before the first write, so a request of several rows cannot
 * half-apply.
 *
 * A `null` is skipped: clearing a reference needs no check. A repeated id counts
 * once. An id that does not exist is refused like a foreign one, with the same
 * message, so the answer does not say which Event holds it.
 */
export async function assertRowsBelongToEvent(
  db: SupabaseClient,
  table: EventOwnedTable,
  noun: string,
  eventId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const named = [...new Set(ids.filter((id): id is string => id != null))];
  if (named.length === 0) return;
  const { data, error } = await db.from(table).select('id').eq('event_id', eventId).in('id', named);
  if (error) throw new BadRequestException(error.message);
  if ((data ?? []).length !== named.length) {
    throw new BadRequestException(`Every ${noun} must belong to this event`);
  }
}

/**
 * Refuse another Event's Tournament. A programme bar and a sheet row name one.
 * Generate reads a bar's Tournament's bouts by id alone, so a foreign one made it
 * read another Event's bouts, and migration 0197 then refused their placement
 * partway through Generate, after the earlier bars' bouts were written.
 */
export function assertTournamentsBelongToEvent(
  db: SupabaseClient,
  eventId: string,
  tournamentIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertRowsBelongToEvent(db, 'tournaments', 'Tournament', eventId, tournamentIds);
}

/** Refuse another Event's Workshop. A programme bar names one. */
export function assertWorkshopsBelongToEvent(
  db: SupabaseClient,
  eventId: string,
  workshopIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertRowsBelongToEvent(db, 'workshops', 'Workshop', eventId, workshopIds);
}
