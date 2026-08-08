'use client';

import { useSyncExternalStore } from 'react';

/**
 * The event this tablet last signed into.
 *
 * A volunteer picks up the same borrowed tablet on the second morning of a
 * two-day event and should not have to find their event in a list again. So the
 * choice is remembered and pre-selected.
 *
 * It is NEVER auto-submitted. A tablet carried from yesterday's event to a
 * different one today must show the stale choice and let the volunteer change
 * it — silently signing them into the wrong event is the failure this whole
 * picker exists to prevent, and remembering the answer would reintroduce it in
 * a form that is harder to notice.
 *
 * ── Why useSyncExternalStore and not useState + useEffect ───────────────────
 * Two reasons, both hard constraints in this repo:
 *   * `react-hooks/set-state-in-effect` is an ERROR here (max-warnings 0), so
 *     the read-localStorage-then-setState shape does not compile past lint.
 *   * The login page reads its querystring the same way ON PURPOSE, because
 *     `useSearchParams` makes the React Compiler bail out of the page. Reading
 *     this through a different mechanism would put the two sources of the same
 *     prefill on different render paths.
 * The server snapshot is a stable `null`, so SSR renders "nothing remembered"
 * and hydration matches.
 */

const STORAGE_KEY = 'myclash.staff.lastEvent.v1';

/** Slug and id both: the id is what login prefers, the slug is what the URL carries. */
export interface RememberedEvent {
  id: string;
  slug: string;
  name: string;
}

const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedValue: RememberedEvent | null = null;

function parse(raw: string | null): RememberedEvent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedEvent>;
    // All three or nothing. A half-written blob (an older bundle, a hand-edited
    // value) must degrade to "nothing remembered" rather than to a row that
    // renders blank and submits an empty id.
    if (!parsed.id || !parsed.slug || !parsed.name) return null;
    return { id: parsed.id, slug: parsed.slug, name: parsed.name };
  } catch {
    return null;
  }
}

function getSnapshot(): RememberedEvent | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  // Only swap the cached reference when the underlying blob changes, so the
  // snapshot stays referentially stable between renders — returning a fresh
  // object every call makes useSyncExternalStore loop forever.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function getServerSnapshot(): RememberedEvent | null {
  return null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // `storage` fires only in OTHER tabs, which is why the local listener set
  // exists too — a tablet with the login page open in two tabs is rare, but a
  // write that does not notify its own tab is a bug either way.
  if (typeof window !== 'undefined') window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', callback);
  };
}

/** Remember the event a volunteer just signed into. Best-effort. */
export function rememberEvent(event: RememberedEvent): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(event);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Private browsing, or a full quota. Remembering is a convenience; failing
    // to remember must never stop a volunteer signing in.
    return;
  }
  cachedRaw = raw;
  cachedValue = event;
  for (const listener of listeners) listener();
}

/** The remembered event, or null. Stable across renders. */
export function useRememberedEvent(): RememberedEvent | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
