/**
 * Ask the browser to keep the tablet's storage (gap 5 of the pad's offline mode).
 *
 * The queue of hits waiting for a network is in IndexedDB (`db.ts`). Storage a
 * site never asked to keep is "best effort": a tablet short of space may clear
 * it, and the hits with it. `navigator.storage.persist()` asks for it to be
 * kept. The browser decides without a word to the referee (Chrome grants it to
 * an installed or often-used site), so the answer only goes to the console:
 * there is nothing a referee could do about a refusal.
 */

type KeptStorage = Pick<StorageManager, 'persisted' | 'persist'>;

export type StorageVerdict = 'kept' | 'refused' | 'unsupported';

export async function keepTabletStorage(storage: KeptStorage | undefined): Promise<StorageVerdict> {
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'kept';
    return (await storage.persist()) ? 'kept' : 'refused';
  } catch {
    return 'refused';
  }
}

let asked = false;

/** Once per tab, when the queue first starts. */
export function keepTabletStorageOnce(): void {
  if (asked || typeof navigator === 'undefined') return;
  asked = true;
  void keepTabletStorage(navigator.storage).then((verdict) => {
    if (verdict !== 'kept') console.info(`[storage] the tablet's storage is not kept: ${verdict}`);
  });
}
