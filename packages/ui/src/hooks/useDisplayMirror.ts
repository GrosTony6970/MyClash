'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * "Swap sides" of a TV scoreboard (quick win T4): red and blue change columns,
 * for a screen that faces the public. The one owner of the choice and of where
 * it is kept.
 *
 * The choice is kept in the browser, so it holds when the screen moves to the
 * next bout and when the page is loaded again. Each screen has its own default:
 * the organiser's popup starts swapped, the public piste TV does not.
 *
 * A browser that refuses its storage (private mode) still swaps: the choice is
 * then kept in memory, for as long as the page lives.
 */
export const MIRROR_STORAGE_KEY = 'myclash:display:mirror';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

let inMemory: string | null = null;
const listeners = new Set<() => void>();

/** What was chosen on this screen: 'true', 'false', or null for nothing yet. */
export function readMirror(store: Store | null): string | null {
  try {
    return store?.getItem(MIRROR_STORAGE_KEY) ?? inMemory;
  } catch {
    return inMemory;
  }
}

export function writeMirror(store: Store | null, mirror: boolean): void {
  inMemory = String(mirror);
  try {
    store?.setItem(MIRROR_STORAGE_KEY, inMemory);
  } catch {
    // Kept in memory above.
  }
  for (const listener of listeners) listener();
}

/** The choice when one was made, the screen's default when none was. */
export function mirrorOf(stored: string | null, defaultOn: boolean): boolean {
  return stored === null ? defaultOn : stored === 'true';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the same browser changed it.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const browserStore = (): Store | null => (typeof window === 'undefined' ? null : localStorage);

/** `[mirror, toggle]`. The server renders the default; the browser then reads the choice. */
export function useDisplayMirror(defaultOn: boolean): [boolean, () => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => readMirror(browserStore()),
    () => null,
  );
  const mirror = mirrorOf(stored, defaultOn);
  const toggle = useCallback(() => writeMirror(browserStore(), !mirror), [mirror]);
  return [mirror, toggle];
}
