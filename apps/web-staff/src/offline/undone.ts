import { db, type UndoneEntry } from './db';

/**
 * One day. Nobody who may score the bout came back to the tablet: the undo is
 * let go (ruling 365). And the notice of an undo that was not carried out is
 * kept as long for its bout's screen (ruling 370).
 */
export const KEPT_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * The entries the undo took off the tablet and the server was not yet asked
 * for (ruling 350). `takeOffTablet` writes a row; `lib/settle-undone.ts` asks
 * the server and forgets it.
 */
export function listUndone(): Promise<UndoneEntry[]> {
  return db.undone.toArray();
}

export async function forgetUndone(clientUuid: string): Promise<void> {
  await db.undone.delete(clientUuid);
}
