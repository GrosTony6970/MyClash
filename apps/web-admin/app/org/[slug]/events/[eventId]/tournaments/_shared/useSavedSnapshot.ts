'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * A settings tab tells its page whether it holds unsaved edits (O15, operator 2026-10-14), so
 * the page asks before a tab switch, a link or closing the browser tab throws them away. The tab
 * reports "nothing unsaved" when it goes, since its edits go with it.
 */
export function useDirtyReport(dirty: boolean, onDirtyChange?: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
}

/** Two values of a form are the same when they would be sent the same. */
export function sameForm(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The tab's form as last read or saved, against what it shows now: null until the tab's read
 * lands, so nothing reads as unsaved before it. The tab calls the returned setter with what it
 * read, and with what a saved write sent (an updater when one save covers only some fields). The
 * rules tabs keep theirs in `useEffectiveRules`.
 */
export function useSavedSnapshot<T>(
  current: T | null,
  onDirtyChange?: (dirty: boolean) => void,
): Dispatch<SetStateAction<T | null>> {
  const [saved, setSaved] = useState<T | null>(null);
  useDirtyReport(current !== null && saved !== null && !sameForm(current, saved), onDirtyChange);
  return setSaved;
}
