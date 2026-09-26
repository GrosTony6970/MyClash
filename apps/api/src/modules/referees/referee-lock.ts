/**
 * referee-lock.ts — "the referee board is locked" has one owner (ADR-019).
 *
 * The lock route turns every `assigned` row of the Event `confirmed` and notifies the
 * referees. Locked = the Event holds a `confirmed` Pool- or bout-scoped row: the scopes the
 * board reads (`listAssignments`). Every door that writes referees answers 409
 * `referee_board_locked` while it is — the organiser unlocks first, so nobody's duty
 * changes after they were told it.
 *
 * A failed read throws a plain Error (a 5xx): "no row" would read as unlocked.
 *
 * The race, named: this read and the door's write are two calls. A lock that lands
 * between them lets that one write through as `assigned` beside the confirmed rows; the
 * board shows it and the next lock confirms it. Accepted: no referee is told a duty that
 * changed under them, which is what the lock protects.
 */
import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function isRefereeBoardLocked(
  db: Pick<SupabaseClient, 'from'>,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('referee_assignments')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .in('scope_type', ['pool', 'match'])
    .limit(1);
  if (error) throw new Error(`Could not read the referee lock: ${error.message}`);
  return (data ?? []).length > 0;
}

export function refereeBoardLocked(): ConflictException {
  return new ConflictException({
    code: 'referee_board_locked',
    message: 'Referee assignments are locked. Unlock them before changing a referee.',
  });
}

export async function assertRefereeBoardUnlocked(
  db: Pick<SupabaseClient, 'from'>,
  eventId: string,
): Promise<void> {
  if (await isRefereeBoardLocked(db, eventId)) throw refereeBoardLocked();
}
