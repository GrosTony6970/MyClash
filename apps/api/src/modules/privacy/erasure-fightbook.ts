import type { RedactionCounts } from './erasure.service';

/** The service-role client's `from`, as far as these deletes use it. */
export interface FightBookEraseClient {
  from: (table: string) => unknown;
}

interface DeleteChain {
  delete: () => {
    in: (
      column: string,
      values: string[],
    ) => {
      select: (
        columns: string,
      ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
}

/** The service-role client's `rpc`, as far as the flag erasure uses it. */
export interface FightBookRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Account erasure's safety-flag step: `fightbook_flags_erase` deletes the flags about the erased
 * account's profiles and clears the reporter on the flags they wrote (the flag stays, with its
 * spar snapshot). It runs EVEN WITH NO CLAIMED PROFILE: its `subject_user_id` clause still finds
 * flags about an account that unlinked its profile. The function reads `claimed_by_user_id`, so it
 * runs before the profile update clears it. Counts: `spar_flags` and `spar_flags.reporter`. A
 * refusal throws, as the other steps do.
 */
export async function eraseFightBookFlags(
  db: FightBookRpcClient,
  uid: string,
  globalPersonIds: string[],
): Promise<RedactionCounts> {
  const { data, error } = await db.rpc('fightbook_flags_erase', {
    p_uid: uid,
    p_ids: globalPersonIds,
  });
  if (error) throw new Error(`fightbook_flags_erase: ${error.message}`);
  const answer = (data ?? {}) as { deleted?: number; cleared?: number };
  return { spar_flags: answer.deleted ?? 0, 'spar_flags.reporter': answer.cleared ?? 0 };
}

/**
 * Every FightBook row of an erased profile, both ways: the floor tools' rows, the requests they sent and received, their
 * private notes, the thank-yous and anonymous reviews they wrote and received, the blocks they
 * made and the blocks aimed at them, the favourites they chose and the ones naming them. Notes
 * and the two review tables come before the requests: deleting a request takes the notes and
 * reviews on it by cascade, uncounted, and these counts say what each delete found. Favourites
 * hang from no request, so their place in the list is free. The floor tools' rows lead the list:
 * the QR codes first (a code delete takes the profile's key-share lock, migration 0270's lock
 * order, before anything else deletes), then the answers, the calls (as the one picked, then as
 * poster) and the free-now mark, all before the requests.
 */
export const FIGHTBOOK_ROWS: readonly [table: string, column: string][] = [
  ['fightbook_qr_codes', 'global_person_id'],
  ['spar_open_call_answers', 'answerer_global_person_id'],
  ['spar_open_calls', 'picked_global_person_id'],
  ['spar_open_calls', 'poster_global_person_id'],
  ['fightbook_free_now', 'global_person_id'],
  ['spar_private_notes', 'author_global_person_id'],
  ['spar_thanks', 'author_global_person_id'],
  ['spar_thanks', 'subject_global_person_id'],
  ['spar_anonymous_reviews', 'author_global_person_id'],
  ['spar_anonymous_reviews', 'subject_global_person_id'],
  ['fightbook_favourites', 'owner_global_person_id'],
  ['fightbook_favourites', 'favourite_global_person_id'],
  ['spar_requests', 'asker_global_person_id'],
  ['spar_requests', 'receiver_global_person_id'],
  ['fightbook_blocks', 'blocker_global_person_id'],
  ['fightbook_blocks', 'blocked_global_person_id'],
];

/**
 * Account erasure's FightBook step (`ErasureService.redactSubject`). Keyed on the profile, not the
 * account: FightBook rows hold profile ids. Kept out of `deleteRowsAimedAt` on purpose: the
 * anonymisation runs that list too, and an anonymised fighter keeps their account and needs their
 * blocks. Two deletes on one table add their counts. A failed delete throws: erasure is retried
 * whole, and these rows are found again by the same profile ids.
 */
export async function eraseFightBookRows(
  db: FightBookEraseClient,
  globalPersonIds: string[],
): Promise<RedactionCounts> {
  const counts: RedactionCounts = {};
  if (globalPersonIds.length === 0) return counts;
  for (const [table, column] of FIGHTBOOK_ROWS) {
    const { data, error } = await (db.from(table) as DeleteChain)
      .delete()
      .in(column, globalPersonIds)
      .select('id');
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    counts[table] = (counts[table] ?? 0) + (data ?? []).length;
  }
  return counts;
}
