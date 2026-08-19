# Pools Realtime Rescope Implementation Plan

> **Status (2026-08-19):** Shipped — the pools page and its realtime merge live at `apps/web-admin/app/org/[slug]/events/[eventId]/pools/`, including `_tabs/match-scores-merge.ts`. Historical record; do not execute.

**Goal:** Rescope the previously-deferred realtime work (Tasks 14 + 16 of the original Pools overhaul plan) by adding Supabase realtime subscriptions on the Matches and Standings tabs, with a polling fallback for websocket disconnects.

**Architecture:** A small shared hook `useRealtimeWithFallback` in `apps/web-admin/src/lib/supabase-browser.ts` wraps a singleton anon Supabase client. The hook subscribes to `postgres_changes` on the matches table filtered by `phase_id`; on websocket error/disconnect it falls back to a 30s `setInterval` poll that calls the page's existing `refresh()` handler. MatchesTab does in-place row merges on each event (cheap); StandingsTab does full refetch (ranking can shift). The hook tears down both the channel and the timer on unmount.

**Tech Stack:** `@supabase/supabase-js` v2.105.1 (already a dep of web-admin), React 19, Next.js 16 App Router.

**Spec:** [docs/superpowers/archive/specs/2026-05-20-pools-overhaul-design.md](docs/superpowers/archive/specs/2026-05-20-pools-overhaul-design.md)

---

## Why this is small now

The original v1 descoped realtime because I thought web-admin had no Supabase browser-client infrastructure. The actual state of the repo:

- `@supabase/supabase-js` is already a dep (`apps/web-admin/package.json:24`).
- An anon client exists at [`apps/web-admin/src/lib/oauth-supabase.ts`](apps/web-admin/src/lib/oauth-supabase.ts) for the OAuth flow.
- `matches` table is published to `supabase_realtime` with `REPLICA IDENTITY FULL` ([0004_realtime.sql:21,33-36,52](packages/db/migrations/0004_realtime.sql)).
- RLS allows anon SELECT on `matches` when `events.status ∈ {published, running, completed}` ([0002_rls.sql:523-532](packages/db/migrations/0002_rls.sql)).

So no migration, no new env vars, no auth bridge work. Just a hook + two consumer integrations.

---

## File map

**Create:**

- `apps/web-admin/src/lib/supabase-browser.ts` — singleton client + `useRealtimeWithFallback` hook.

**Modify:**

- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx` — add realtime hook with in-place row merge.
- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx` — add realtime hook with full refetch.

The existing `Refresh` button on both tabs stays — it's still useful as a manual override.

---

## Task 1: Shared `useRealtimeWithFallback` hook + singleton client

**Files:**

- Create: `apps/web-admin/src/lib/supabase-browser.ts`

- [ ] **Step 1: Create the file**

```ts
'use client';

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';

let client: SupabaseClient | null = null;

/**
 * Singleton anon Supabase browser client. Reused across all realtime
 * subscriptions in web-admin so we don't churn websocket connections
 * across tab switches. Anon-only — web-admin's session auth is handled
 * server-side via cookies + the REST API, not via Supabase JWTs.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    if (!url || !anon) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
    }
    client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export interface UseRealtimeOptions {
  /** Unique channel name per page/tab. */
  channelName: string;
  /** Table to subscribe to (e.g. 'matches'). */
  table: string;
  /** PostgREST-style filter expression, e.g. `phase_id=eq.UUID`. */
  filter: string;
  /** Postgres event to listen for. Defaults to '*' (all). */
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  /** Called once per realtime event while the websocket is healthy. */
  onEvent: (payload: {
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
    eventType: string;
  }) => void;
  /** Called every fallbackPollMs while the websocket is disconnected. */
  onFallbackPoll: () => void;
  /** Polling interval (ms) used while the websocket is unhealthy. Default 30s. */
  fallbackPollMs?: number;
}

/**
 * Subscribes to a Supabase realtime channel and falls back to a setInterval
 * poll whenever the websocket is not in the SUBSCRIBED state.
 *
 * Behavior:
 *   • On SUBSCRIBED → stop polling.
 *   • On CHANNEL_ERROR / TIMED_OUT / CLOSED → start polling (or keep polling
 *     if we never connected). Polling resumes the live view as soon as the
 *     channel re-subscribes successfully.
 *   • On unmount → stop polling AND remove the channel.
 */
export function useRealtimeWithFallback(opts: UseRealtimeOptions): void {
  const pollTimerRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let connected = false;

    function startPolling() {
      if (pollTimerRef.current !== null) return;
      pollTimerRef.current = window.setInterval(
        () => opts.onFallbackPoll(),
        opts.fallbackPollMs ?? 30_000,
      );
    }
    function stopPolling() {
      if (pollTimerRef.current === null) return;
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const channel = supabase
      .channel(opts.channelName)
      .on(
        'postgres_changes',
        {
          event: opts.event ?? '*',
          schema: 'public',
          table: opts.table,
          filter: opts.filter,
        },
        (payload) =>
          opts.onEvent({
            new: (payload.new ?? null) as Record<string, unknown> | null,
            old: (payload.old ?? null) as Record<string, unknown> | null,
            eventType: payload.eventType,
          }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          connected = true;
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          connected = false;
          startPolling();
        }
      });

    channelRef.current = channel;

    return () => {
      stopPolling();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.channelName, opts.table, opts.filter, opts.event]);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web-admin/src/lib/supabase-browser.ts
git commit -m "feat(web-admin): useRealtimeWithFallback hook + singleton Supabase browser client"
```

---

## Task 2: Wire realtime into MatchesTab

In-place merge of changed match rows on each event; fallback poll calls the existing `refresh()`.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`

- [ ] **Step 1: Add the import**

At the top of the file, alongside the existing imports:

```tsx
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
```

If the `@/lib/...` alias isn't configured for this app, use the relative path `../../../../../../src/lib/supabase-browser`. Check `apps/web-admin/tsconfig.json` for `paths` to confirm the alias.

- [ ] **Step 2: Add the hook call inside the component**

After the existing `useEffect` that loads initial data (around line 64-94), add:

```tsx
useRealtimeWithFallback({
  channelName: `pool-matches-list-${tournamentId}`,
  table: 'matches',
  filter: `phase_id=eq.${poolPhaseId}`,
  event: '*',
  onEvent: (payload) => {
    const incoming = payload.new as MatchRow | null;
    if (!incoming) return;
    setPools((prev) =>
      prev.map((pool) => ({
        ...pool,
        matches: pool.matches.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
      })),
    );
  },
  onFallbackPoll: refresh,
  fallbackPollMs: 30_000,
});
```

`refresh` is the existing `setRefreshKey((k) => k + 1)` callback already declared in the component (line 62).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx"
git commit -m "feat(web-admin): realtime + polling fallback on Matches tab"
```

---

## Task 3: Wire realtime into StandingsTab

Full refetch on each event (ranking can shift on any match change).

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx`

- [ ] **Step 1: Accept `poolPhaseId` as a used prop**

The component currently destructures only `tournamentId` from props even though the props type declares `poolPhaseId`. Update the destructure:

```tsx
export function StandingsTab({ tournamentId, poolPhaseId }: StandingsTabProps) {
```

- [ ] **Step 2: Add the import**

At the top of the file:

```tsx
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
```

(Or relative path, matching MatchesTab's convention.)

- [ ] **Step 3: Add the hook call inside the component**

After the existing `useEffect` that fetches standings (around line 75-85), add:

```tsx
useRealtimeWithFallback({
  channelName: `pool-standings-${tournamentId}-${mode}`,
  table: 'matches',
  filter: `phase_id=eq.${poolPhaseId}`,
  event: '*',
  onEvent: refresh,
  onFallbackPoll: refresh,
  fallbackPollMs: 30_000,
});
```

`refresh` is the existing `setRefreshKey((k) => k + 1)` callback already declared in the component (line 64). Note: `channelName` includes `mode` because Overall and By-pool views render differently — but the subscription itself is identical, so the channel name just disambiguates so React doesn't reuse a stale subscription.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx"
git commit -m "feat(web-admin): realtime + polling fallback on Standings tab"
```

---

## Task 4: Final verification

- [ ] **Step 1: Full workspace typecheck**

```bash
pnpm -r typecheck
```

Expected: all 13 packages clean.

- [ ] **Step 2: Full backend test suite (regression check)**

```bash
pnpm --filter api test
```

Expected: 517/517 passing.

- [ ] **Step 3: Full web-admin tests**

```bash
pnpm --filter web-admin test
```

Expected: 29/29 passing.

- [ ] **Step 4: Manual smoke — realtime path**

1. Open `/org/<slug>/events/<eventId>/pools` on a tournament with pools + at least one match.
2. Open a second browser tab (or another machine) and complete a match via the scoring screen.
3. Within ~1 second, the first tab's Matches column should update (Status pill → completed, Score column → final score).
4. Same test for Standings tab: complete another match → standings refetches automatically.

- [ ] **Step 5: Manual smoke — fallback path**

1. With the Matches tab open, open browser devtools → Network panel → set throttling to "Offline".
2. Wait ~5 seconds (websocket times out, hook falls back to polling).
3. Set throttling back to "Online". Complete a match from another tab/machine.
4. Within 30s, the offline-throttled tab should refresh (polling kicked in).
5. Wait for websocket to re-subscribe; complete another match → updates live again.

- [ ] **Step 6: Push**

```bash
git push
```

- [ ] **Step 7: Done.**

---

## Verification

- Singleton client: subsequent calls to `getSupabaseBrowser()` return the same instance (no new websocket per tab switch).
- Channel filter: PostgREST filter `phase_id=eq.${poolPhaseId}` correctly narrows realtime events to this tournament's pool phase only — other tournaments' match changes don't leak into the subscription.
- Cleanup: navigating away from `/pools` removes the channel and clears any polling timer (verify in devtools → Application → WebSockets).
- RLS: open the page as an unauthenticated visitor or as an operator without access to a draft event — the subscription should still work for `events.status ∈ {published, running, completed}` per [0002_rls.sql:523-532](packages/db/migrations/0002_rls.sql); draft events return no rows but don't error.

## Open items for the implementation plan

- Confirm `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the deployed web-admin env (they're already required by the existing OAuth client, so this should be a no-op — verify when implementing).
- Confirm the `@/lib/...` path alias is configured in `apps/web-admin/tsconfig.json`. If not, use the relative path consistently across both tabs.
