'use client';

import { useCallback, useState } from 'react';

/**
 * Which cards have a write on its way. `run(id, write)` marks the card for as long as the write
 * runs; `inFlight(id)` disables its buttons, so a second tap cannot send the same write twice.
 * Several cards may each have one write running at once.
 */
export function useInFlight() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const run = useCallback(async <T>(id: string, write: () => Promise<T>): Promise<T> => {
    setIds((current) => new Set(current).add(id));
    try {
      return await write();
    } finally {
      setIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);
  return { inFlight: (id: string) => ids.has(id), run };
}
