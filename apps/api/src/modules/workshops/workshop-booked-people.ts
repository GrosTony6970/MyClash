import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inListChunks, READ_PAGE } from '../../common/postgrest-in-list';
import { sessionCancelledRefusal } from './session-cancelled';

/**
 * Who a message to a Workshop's people reaches (operator rulings 530-533): a seat or a waitlist
 * place, as the automatic notices tell them. This is not `PLACE_HOLDING_STATUSES`, which adds
 * `intent` to say who HOLDS a place: do not merge the two lists.
 */
const TOLD_STATUSES = ['confirmed', 'waitlisted'];

/** One session of one Workshop (530), or every session of these Workshops. */
export type BookedScope = { workshopId: string; sessionId: string } | { workshopIds: string[] };

/**
 * The roster rows (`persons.id`) of the people booked, each once. A cancelled session tells
 * nobody (531): its places hold nothing. A message to one cancelled session is refused (532).
 *
 * A booking's `user_id` holds a `persons.id` with no foreign key, so nothing is embedded. A read
 * that fails throws: read as "nobody", the sender would be told the message reached 0 people.
 */
export async function bookedPersonIds(db: SupabaseClient, scope: BookedScope): Promise<string[]> {
  const sessionIds =
    'sessionId' in scope
      ? [await openSession(db, scope.workshopId, scope.sessionId)]
      : await runningSessions(db, scope.workshopIds);
  const ids = new Set<string>();
  for (const piece of inListChunks(sessionIds)) {
    for (const row of await toldBookings(db, piece)) if (row.user_id) ids.add(row.user_id);
  }
  return [...ids];
}

/**
 * Every told booking of these sessions. A whole Event's Workshops can hold more than the 1000 rows
 * PostgREST answers at most, and it cuts the rest without a word: read page after page, by id,
 * until a page comes back empty (`READ_PAGE`).
 */
async function toldBookings(
  db: SupabaseClient,
  sessionIds: string[],
): Promise<Array<{ id: string; user_id: string | null }>> {
  const rows: Array<{ id: string; user_id: string | null }> = [];
  for (;;) {
    let query = db
      .from('workshop_enrollments')
      .select('id, user_id')
      .in('workshop_session_id', sessionIds)
      .in('status', TOLD_STATUSES)
      .order('id');
    const last = rows.at(-1);
    if (last) query = query.gt('id', last.id);
    const { data, error } = await query.limit(READ_PAGE);
    if (error) throw new Error(`The bookings of sessions were not read: ${error.message}`);
    const page = (data ?? []) as Array<{ id: string; user_id: string | null }>;
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

/** The session, if it belongs to the Workshop and still runs. */
async function openSession(
  db: SupabaseClient,
  workshopId: string,
  sessionId: string,
): Promise<string> {
  const { data, error } = await db
    .from('workshop_sessions')
    .select('workshop_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`Session ${sessionId} was not read: ${error.message}`);
  const session = data as { workshop_id: string; status: string | null } | null;
  if (session?.workshop_id !== workshopId) {
    throw new NotFoundException(`Session ${sessionId} not found in this Workshop`);
  }
  if (session.status === 'cancelled') throw sessionCancelledRefusal();
  return sessionId;
}

/** The sessions of these Workshops that are not cancelled. */
async function runningSessions(db: SupabaseClient, workshopIds: string[]): Promise<string[]> {
  if (workshopIds.length === 0) return [];
  const { data, error } = await db
    .from('workshop_sessions')
    .select('id')
    .in('workshop_id', workshopIds)
    .neq('status', 'cancelled');
  if (error) throw new Error(`The sessions of workshops were not read: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}
