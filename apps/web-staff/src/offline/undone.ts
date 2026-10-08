import { db, type UndoneEntry } from './db';

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
