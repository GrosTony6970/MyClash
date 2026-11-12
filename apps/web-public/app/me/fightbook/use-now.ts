'use client';

import { useEffect, useState } from 'react';

/** The longest a timer may wait (a larger delay fires at once). */
const LONGEST_WAIT_MS = 2 ** 31 - 1;

/**
 * The time now, read again each time one of `moments` (ISO strings) passes, so a button that
 * shows from one moment, or hides at another, changes on screen without a tap. The API still
 * judges every write on its own clock; this only decides what the page offers.
 */
export function useNow(moments: string[]): number {
  const [now, setNow] = useState(() => Date.now());
  const key = moments.join('|');
  useEffect(() => {
    const at = Date.now();
    const next = key
      .split('|')
      .map((iso) => Date.parse(iso))
      .filter((ms) => ms > at)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - at + 50, LONGEST_WAIT_MS));
    return () => clearTimeout(timer);
  }, [key, now]);
  return now;
}
