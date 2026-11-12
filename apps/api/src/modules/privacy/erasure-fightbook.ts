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

/**
 * Every FightBook row of an erased profile, both ways: the requests they sent and received, their
 * private notes, the thank-yous and anonymous reviews they wrote and received, the blocks they
 * made and the blocks aimed at them, the favourites they chose and the ones naming them. Notes,
 * reviews and favourites come before the requests: deleting a request takes the notes and
 * reviews on it by cascade, and these counts say what each delete found.
 */
export const FIGHTBOOK_ROWS: readonly [table: string, column: string][] = [
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
