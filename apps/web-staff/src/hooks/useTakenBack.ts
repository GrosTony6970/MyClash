'use client';

import { useEffect, useState } from 'react';
import { listUndone } from '../offline/undone';

const NONE: ReadonlySet<string> = new Set();

/**
 * The entries an undo took off the tablet and the server was not yet asked
 * for, by the id the tablet gave them.
 *
 * The server may still hold such an entry, live, until the settle voids it
 * (`lib/settle-undone.ts`). For the referee it is gone: he took it back. So
 * the screen's lists leave it out, as the undo does (`undoLastEntry`): the
 * last line he sees is the entry his next Undo takes back.
 *
 * Read again on the triggers of `usePendingOutbox`: an undo and a settle both
 * read the bout again, which bumps `refreshKey`.
 */
export function useTakenBack(refreshKey: number, pendingCount: number): ReadonlySet<string> {
  const [takenBack, setTakenBack] = useState(NONE);

  useEffect(() => {
    let cancelled = false;
    void listUndone().then((entries) => {
      if (!cancelled) setTakenBack(new Set(entries.map((entry) => entry.clientUuid)));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, pendingCount]);

  return takenBack;
}

/** The server's rows the referee has not taken back. */
export function notTakenBack<Row extends { client_uuid?: string | null }>(
  rows: Row[],
  takenBack: ReadonlySet<string>,
): Row[] {
  return takenBack.size === 0
    ? rows
    : rows.filter((row) => !row.client_uuid || !takenBack.has(row.client_uuid));
}
