import type { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoutResult } from './instructor-busy';

/**
 * The status and recorded winner of some bouts, by bout id: the Workshop board asks for its
 * instructors' bracket bouts, to know who is out (`instructor-busy.ts`). A read that fails is
 * logged and answers nothing: each instructor then reads as still in their bracket, busy rather
 * than wrongly free.
 */
export async function readBoutResults(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  eventId: string,
  ids: readonly string[],
): Promise<Map<string, BoutResult>> {
  const results = new Map<string, BoutResult>();
  if (ids.length === 0) return results;
  const { data, error } = await db
    .from('matches')
    .select('id, status, winner_registration_id')
    .in('id', [...ids]);
  if (error) {
    logger.warn(
      `Bout results unreadable for event ${eventId}; every instructor stays in their bracket: ${error.message}`,
    );
    return results;
  }
  for (const row of (data ?? []) as Array<{
    id: string;
    status: string;
    winner_registration_id: string | null;
  }>) {
    results.set(row.id, { status: row.status, winnerRegistrationId: row.winner_registration_id });
  }
  return results;
}
