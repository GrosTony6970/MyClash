import { db, type UndoNotice } from './db';

/**
 * The undos the tablet wrote down and did not carry out (rulings 364 to 366).
 * `lib/settle-undone.ts` writes a row; the screen of the row's bout reads its
 * rows, says them, and removes them when the referee closes the notice.
 */
export function noticesOf(matchId: string): Promise<UndoNotice[]> {
  return db.undoNotices.where('matchId').equals(matchId).toArray();
}

/** The referee read them: only the rows the notice showed, never one written since. */
export async function saidNotices(notices: UndoNotice[]): Promise<void> {
  await db.undoNotices.bulkDelete(notices.map((notice) => notice.clientUuid));
}
