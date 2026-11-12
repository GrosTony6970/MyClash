import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/** One word for every lost race or closed window of the agreed-spar routes: 409 `not_open`. */
export const notOpen = () =>
  new ConflictException({ code: 'not_open', message: 'This request is no longer open' });

/** The columns of a spar request every agreed-spar route reads first. */
export const SIDE_SELECT =
  'id, asker_global_person_id, receiver_global_person_id, status, spar_day, zone, expires_at';

export interface SparSideRow {
  id: string;
  asker_global_person_id: string;
  receiver_global_person_id: string;
  status: string;
  spar_day: string;
  zone: string;
  expires_at: string;
}

/**
 * Read a spar request and work out which side `me` is on (cancel, "We sparred" and its undo all
 * start here). A stranger, or a request that does not exist, gets 404, never 403: a 403 would
 * confirm the request exists. The write that follows is a conditional update on this side.
 */
export async function readMySide(
  db: Pick<SupabaseClient, 'from'>,
  me: string,
  requestId: string,
): Promise<{ row: SparSideRow; side: 'asker' | 'receiver'; other: string }> {
  const { data, error } = await db
    .from('spar_requests')
    .select(SIDE_SELECT)
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(`spar read failed: ${error.message}`);
  const row = data as SparSideRow | null;
  const side = row?.asker_global_person_id === me ? 'asker' : 'receiver';
  if (!row || (side === 'receiver' && row.receiver_global_person_id !== me)) {
    throw new NotFoundException('Spar not found');
  }
  const other = side === 'asker' ? row.receiver_global_person_id : row.asker_global_person_id;
  return { row, side, other };
}
