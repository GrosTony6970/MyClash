import { useSyncExternalStore } from 'react';

/**
 * Which groups of the event menu are open: pure helpers, and the localStorage-backed store the
 * shell reads. Split out of ./event-nav-groups (the menu's entries and the rules that filter
 * them) for the 400-line file budget; that module re-exports everything here.
 */

// --- collapse state (pure helpers) ------------------------------------------

/** Map of group key → explicitly-collapsed (`false`) / explicitly-open (`true`). */
export type GroupOpenState = Record<string, boolean>;

/** Parse the persisted blob; tolerate null/garbage and keep only booleans. */
export function parseGroupState(raw: string | null): GroupOpenState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: GroupOpenState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeGroupState(state: GroupOpenState): string {
  return JSON.stringify(state);
}

/** Groups are open by default; only an explicit `false` collapses them. */
export function isGroupOpen(state: GroupOpenState, key: string): boolean {
  return state[key] !== false;
}

/** Returns a new state with `key` set to `open` (does not mutate the input). */
export function nextGroupState(state: GroupOpenState, key: string, open: boolean): GroupOpenState {
  return { ...state, [key]: open };
}

// --- localStorage-backed store (SSR-safe via useSyncExternalStore) ----------
//
// useSyncExternalStore is used instead of useState(localStorage)+useEffect so
// that (a) the server snapshot is a stable empty object (all groups open),
// avoiding a hydration mismatch, and (b) no setState-in-effect is introduced
// (keeps the shell's lint clean under the React Compiler rules).

const STORAGE_KEY = 'myclash.nav.eventGroups.v1';
const EMPTY_STATE: GroupOpenState = {};
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedState: GroupOpenState = EMPTY_STATE;

function getSnapshot(): GroupOpenState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  // Only swap the cached reference when the underlying blob changes, so the
  // snapshot stays referentially stable between renders.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parseGroupState(raw);
  }
  return cachedState;
}

function getServerSnapshot(): GroupOpenState {
  return EMPTY_STATE;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (typeof window !== 'undefined') window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', callback);
  };
}

function writeState(next: GroupOpenState): void {
  if (typeof window === 'undefined') return;
  const raw = serializeGroupState(next);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedState = next;
  for (const listener of listeners) listener();
}

export interface EventNavGroupsController {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** Read/persist which event nav groups are expanded. */
export function useEventNavGroups(): EventNavGroupsController {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    isOpen: (key: string) => isGroupOpen(state, key),
    toggle: (key: string) => {
      const current = getSnapshot();
      writeState(nextGroupState(current, key, !isGroupOpen(current, key)));
    },
  };
}
