import { useCallback, useState } from 'react';

/**
 * Which table rows have a write in flight, one flag per row.
 *
 * A single "busy row" slot let one row's finished write clear another row's
 * flag: row A's archive ends while row B's status save is still out, B's
 * buttons wake up, and a second press sends a second write. Each update here
 * starts from the latest set, so two writes that finish together both land.
 */
export function useBusyRows(): {
  isBusy: (id: string) => boolean;
  setBusy: (id: string, busy: boolean) => void;
} {
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((previous) => {
      if (previous.has(id) === busy) return previous;
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return { isBusy: (id) => busyIds.has(id), setBusy };
}
