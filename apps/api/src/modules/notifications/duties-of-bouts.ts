/**
 * duties-of-bouts.ts — the LOCKED referee duties whose start a write of these bouts can move.
 *
 * A duty starts at the earliest placed bout it covers (`schedule/duty-windows.ts`): its own bout,
 * or every bout of its own Pool. So a bout that gets another time or piste touches the duties on
 * that bout, and the duties on its Pool. A row holds exactly one of piste, Pool and bout
 * (`referee_assignments_scope_check`), so a row with a `pool_id` is a Pool duty. A bout that is
 * DELETED touches the duties on its Pool too, and is asked by its Pool (`lockedDutiesOfPools`).
 *
 * Only locked duties are asked: an unlocked one rings for nobody (operator ruling 220), and the
 * next lock sets its alerts.
 *
 * A failed read throws a plain Error, never "no duty": the caller says what that leaves as it was.
 */
import type { SupabaseService } from '../supabase/supabase.service';

type Db = SupabaseService['service'];

/** A locked duty as both alert families read it: one row serves the referee's and his followers'. */
export interface LockedDuty {
  id: string;
  person_id: string | null;
  event_id: string | null;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
  status: string | null;
  matches?: {
    match_number_label?: string | null;
    lices?: { name?: string | null } | null;
  } | null;
}

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

/** The rows a read answered. */
function rowsOf<T>(what: string, { data, error }: Answer): T[] {
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return (data ?? []) as T[];
}

/** `matchIds`: at most `IN_LIST_MAX` of them, as the refresher hands its bouts. */
export async function lockedDutiesOfBouts(
  db: Db,
  matchIds: readonly string[],
): Promise<LockedDuty[]> {
  if (matchIds.length === 0) return [];
  const bouts = rowsOf<{ pool_id: string | null }>(
    'moved bouts',
    await db.from('matches').select('id, pool_id').in('id', matchIds),
  );
  const onBouts = rowsOf<LockedDuty>(
    'duties on the moved bouts',
    await db
      .from('referee_assignments')
      .select(
        'id, person_id, event_id, pool_id, match_id, role, status, matches ( match_number_label, lices ( name ) )',
      )
      .eq('status', 'confirmed')
      .in('match_id', matchIds),
  );
  const poolIds = [...new Set(bouts.map((bout) => bout.pool_id).filter(Boolean))] as string[];
  return [...onBouts, ...(await lockedDutiesOfPools(db, poolIds))];
}

/**
 * The locked duties on these Pools: the door for bouts that were deleted, which cannot be named
 * any more. A duty on one of the deleted bouts went with its bout (0179), so only the Pool's own
 * duties are left to ask. `poolIds`: at most `IN_LIST_MAX` of them.
 */
export async function lockedDutiesOfPools(
  db: Db,
  poolIds: readonly string[],
): Promise<LockedDuty[]> {
  if (poolIds.length === 0) return [];
  return rowsOf<LockedDuty>(
    'duties on the Pools',
    await db
      .from('referee_assignments')
      .select(
        'id, person_id, event_id, pool_id, match_id, role, status, matches ( match_number_label, lices ( name ) )',
      )
      .eq('status', 'confirmed')
      .in('pool_id', poolIds),
  );
}
