'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Same-tab subscribers (the `storage` event only fires in *other* tabs), so a
// toggle in one card notifies every persisted-open hook to re-read its key.
const listeners = new Set<() => void>();

function readValue(key: string, defaultOpen: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === '1' ? true : raw === '0' ? false : defaultOpen;
  } catch {
    return defaultOpen;
  }
}

/**
 * A boolean UI toggle persisted to localStorage under a stable key, so the
 * open/closed state of groups and member cards survives navigation + reload.
 * Backed by useSyncExternalStore so the server render (and hydration) use
 * `defaultOpen`, then the stored value is applied post-hydration without a
 * mismatch. Falls back to `defaultOpen` when localStorage is unavailable.
 */
export function usePersistedOpen(
  key: string,
  defaultOpen: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const open = useSyncExternalStore(
    subscribe,
    () => readValue(key, defaultOpen),
    () => defaultOpen,
  );

  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(readValue(key, defaultOpen)) : next;
      try {
        window.localStorage.setItem(key, value ? '1' : '0');
      } catch {
        /* ignore write failures */
      }
      listeners.forEach((listener) => listener());
    },
    [key, defaultOpen],
  );

  return [open, set];
}
