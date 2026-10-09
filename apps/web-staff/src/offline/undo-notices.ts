import { db, type UndoNotice } from './db';
import { KEPT_FOR_MS } from './undone';

/**
 * The undos the tablet wrote down and did not carry out (rulings 364 to 366).
 * `lib/settle-undone.ts` writes a row; the screen of the row's bout reads its
 * rows, says them, and removes them when the referee closes the notice.
 *
 * A notice is said for a day (operator ruling 370). One nobody read by then
 * is said no more, and `dropUnreadNotices` removes it: a bout nobody opens
 * again kept its rows on the tablet for ever.
 */
const saidUntil = (notice: UndoNotice) => notice.writtenAt + KEPT_FOR_MS;

export async function noticesOf(matchId: string): Promise<UndoNotice[]> {
  const now = Date.now();
  const rows = await db.undoNotices.where('matchId').equals(matchId).toArray();
  return rows.filter((notice) => now < saidUntil(notice));
}

/** Remove the notices of every bout that nobody read for a day. */
export async function dropUnreadNotices(): Promise<void> {
  const now = Date.now();
  await db.undoNotices.filter((notice) => now >= saidUntil(notice)).delete();
}

/** The referee read them: only the rows the notice showed, never one written since. */
export async function saidNotices(notices: UndoNotice[]): Promise<void> {
  await db.undoNotices.bulkDelete(notices.map((notice) => notice.clientUuid));
}
