/**
 * Shared client-side state for "which organisers do I follow".
 *
 * WHY A STORE: the directory renders one follow button per card. If each button
 * fetched its own state on mount, a page of 24 organisers would fire 24
 * identical requests for the same list, and unfollowing on one surface would
 * leave every other copy of that organiser stale. This holds one set, loads it
 * once, and notifies every subscriber on change.
 *
 * Deliberately plain module state + subscribe/getSnapshot rather than a React
 * context: the consumers sit on unrelated pages (event header, /o/[slug],
 * /organisers) with no common client boundary to hang a provider on, and
 * `useSyncExternalStore` is the pattern web-public already uses for
 * outside-React state — `react-hooks/set-state-in-effect` runs at
 * max-warnings 0, so the fetch-then-setState alternative would not lint.
 */

// Relative, not the `@/` alias: web-public has no vitest config, so vitest
// resolves neither tsconfig paths nor Next's alias, and this module is unit
// tested. Same reason EventFilterBar reaches for '../../src/i18n/I18nProvider'.
import { getPublicApiUrl } from '../../src/lib/api-url';

export type FollowsStatus = 'loading' | 'ready' | 'anonymous';

export interface FollowsSnapshot {
  status: FollowsStatus;
  /** Organisation ids the signed-in user follows. Empty unless status is 'ready'. */
  ids: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set<string>();
const LOADING: FollowsSnapshot = Object.freeze({ status: 'loading', ids: EMPTY });

let snapshot: FollowsSnapshot = LOADING;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Snapshot identity only changes when the CONTENT changes — useSyncExternalStore
 * re-renders on every getSnapshot() whose result is referentially new, so
 * returning a fresh object each call would loop forever.
 */
function publish(next: FollowsSnapshot): void {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}

interface FollowedOrganizationRow {
  organizationId: string;
}

async function load(): Promise<void> {
  try {
    const res = await fetch(`${getPublicApiUrl()}/api/v1/me/follows/organizations`, {
      credentials: 'include',
    });
    // 401 is the expected logged-out path, not an error worth surfacing: the
    // endpoint rejects guests on purpose, because a follow they can never be
    // notified about is not worth recording.
    if (!res.ok) {
      publish({ status: 'anonymous', ids: EMPTY });
      return;
    }
    const rows = (await res.json()) as FollowedOrganizationRow[];
    publish({ status: 'ready', ids: new Set(rows.map((row) => row.organizationId)) });
  } catch {
    // Offline or aborted — the buttons fall back to their signed-out shape
    // rather than offering a control that cannot work.
    publish({ status: 'anonymous', ids: EMPTY });
  }
}

/** Loads once per page. Repeat callers join the in-flight request. */
export function ensureLoaded(): Promise<void> {
  if (snapshot.status !== 'loading') return Promise.resolve();
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): FollowsSnapshot {
  return snapshot;
}

/**
 * SSR pass of a client component: no cookies to read from here, so every
 * visitor renders the same neutral "loading" shape and the real state arrives
 * on hydration. Must be a stable reference for the same reason as getSnapshot.
 */
export function getServerSnapshot(): FollowsSnapshot {
  return LOADING;
}

function withId(ids: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  const next = new Set(ids);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * Optimistic toggle: the set moves first so every button flips at once, and
 * reverts if the request fails. Returns the state actually in effect.
 */
export async function setFollowing(organizationId: string, following: boolean): Promise<boolean> {
  const before = snapshot;
  publish({ status: 'ready', ids: withId(before.ids, organizationId, following) });

  const apiUrl = getPublicApiUrl();
  try {
    const res = following
      ? await fetch(`${apiUrl}/api/v1/me/follows/organizations`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        })
      : await fetch(`${apiUrl}/api/v1/me/follows/organizations/${organizationId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
    if (res.ok) return following;
  } catch {
    // fall through to the revert
  }
  publish(before);
  return before.ids.has(organizationId);
}

/** Test seam — module state outlives a single test otherwise. */
export function resetOrganizationFollowsStore(): void {
  snapshot = LOADING;
  inFlight = null;
  listeners.clear();
}
