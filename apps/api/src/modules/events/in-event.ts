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

/** A Match row as the membership read returns it: its Event, through its Phase's Tournament. */
interface MatchEventRow {
  id: string;
  phases: { tournaments: { event_id: string } | null } | null;
}

/**
 * Refuse any Match that is not one of this Event's.
 *
 * The one owner of the check, for every door that names Matches by id under an
 * Event and then places or staffs them. A Match has no `event_id`: it reaches its
 * Event through its Phase's Tournament, so the read embeds that path and the Event
 * is compared per row.
 *
 * Migration 0197's trigger is not this check. It refuses a Lice of another Event
 * than the Match's own, so it passes another Event's bout that stays on that
 * Event's own Lice — moved in time, or given a new length. The service-role client
 * bypasses RLS, so this refusal is needed on top of it: the placement owner reads
 * a batch and its lengths by id alone, and writes row by row, so one foreign bout
 * would be read and the rest of the batch committed before anything failed; and a
 * referee assignment has no database guard at all.
 *
 * The same rules as `assertRowsBelongToEvent`: one read, a repeated id counts
 * once, and an id that does not exist is refused like a foreign one, with the
 * same sentence, so the answer does not say which Event holds it.
 */
export async function assertMatchesBelongToEvent(
  db: SupabaseClient,
  eventId: string,
  matchIds: ReadonlyArray<string>,
): Promise<void> {
  const named = [...new Set(matchIds)];
  if (named.length === 0) return;
  const { data, error } = await db
    .from('matches')
    .select('id, phases!inner(tournaments!inner(event_id))')
    .in('id', named);
  if (error) throw new BadRequestException(error.message);
  const own = new Set(
    ((data ?? []) as unknown as MatchEventRow[])
      .filter((row) => row.phases?.tournaments?.event_id === eventId)
      .map((row) => row.id),
  );
  if (named.some((id) => !own.has(id))) {
    throw new BadRequestException('Every Match must belong to this event');
  }
}
