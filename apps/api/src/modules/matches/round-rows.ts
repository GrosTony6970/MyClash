import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { ClockRowCollided } from './late-press';

type Database = SupabaseService['service'];

/**
 * The rows of a round in a bout's timeline: "Start round", "End round", and the rows of a
 * level step. Written by `round-advance.ts`, `round-end.ts` (through the scoring service) and
 * `level-step.ts`.
 */
interface Actor {
  userId?: string;
  staffAccountId?: string;
}

/** Postgres: a unique key refused the row. */
const UNIQUE_VIOLATION = '23505';

/**
 * The row the server holds for this round press, or null for a press that is
 * new to it. An id it holds for another bout, or for another kind of press, is
 * a bad request: read as "saved", it opened or closed a round with no row. A
 * failed read is an error, never "not saved".
 */
export async function savedRoundPress(
  db: Database,
  press: {
    clientUuid: string;
    matchId: string;
    type: 'round_advance' | 'round_end' | 'level_resolution';
  },
): Promise<{ sequence: number } | null> {
  const { data, error } = await db
    .from('match_events')
    .select('match_id, type, sequence')
    .eq('client_uuid', press.clientUuid)
    .maybeSingle();
  if (error) throw new Error(`Could not read a round press: ${error.message}`);
  const row = data as { match_id: string; type: string; sequence: number } | null;
  if (!row) return null;
  if (row.match_id !== press.matchId || row.type !== press.type) {
    throw new BadRequestException('This id is the id of another press');
  }
  return { sequence: row.sequence };
}

async function nextSequence(db: Database, matchId: string): Promise<number> {
  const { data: last } = await db
    .from('match_events')
    .select('sequence')
    .eq('match_id', matchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((last as { sequence: number } | null)?.sequence ?? 0) + 1;
}

/**
 * Write a round's row in the bout's timeline, and say when it is not written.
 *
 * `round_advance` is state, not an audit line: `computeClockState` reads it as
 * the marker that puts the level-at-time chain back to the top. A late row
 * carries the id of its press, which is what answers the second send. A late
 * one that loses its sequence, or its own id, to another writer says so with
 * `ClockRowCollided`.
 *
 * A step of a level bout writes its rows here too (`level-step.ts`): the Halt
 * of a clock that runs, which has a time and no id, and the step itself, with
 * the correction of the clock its extra time gives.
 */
export async function writeRoundRow(
  db: Database,
  matchId: string,
  written: {
    type: 'round_advance' | 'round_end' | 'halt' | 'level_resolution';
    reason: string;
    adjustmentMs?: number;
  },
  actor: Actor | undefined,
  late?: { clientUuid?: string; at: string; sequence?: number },
): Promise<void> {
  // A late row's sequence is the one read before its rules (`judgedSequence`).
  const sequence = late?.sequence ?? (await nextSequence(db, matchId));
  const { error } = await db.from('match_events').insert({
    match_id: matchId,
    sequence,
    type: written.type,
    reason: written.reason,
    by_user_id: actor?.userId ?? null,
    staff_account_id: actor?.staffAccountId ?? null,
    occurred_at: late?.at ?? new Date().toISOString(),
    ...(written.adjustmentMs !== undefined ? { adjustment_ms: written.adjustmentMs } : {}),
    ...(late?.clientUuid ? { client_uuid: late.clientUuid } : {}),
  });
  if (!error) return;
  if (late && error.code === UNIQUE_VIOLATION) throw new ClockRowCollided();
  throw new BadRequestException(error.message);
}
