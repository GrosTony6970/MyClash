'use client';

import { useSyncExternalStore } from 'react';

/**
 * The offline drill: a fixed window in which this tablet behaves as if the
 * venue's wifi were gone, so the crew meets the offline UI before it matters.
 *
 * ── What it simulates, exactly ──────────────────────────────────────────────
 *
 * The scoring WRITE path, and nothing else. `SyncEngine.postExchange` returns
 * the same synthetic `503 { error: 'offline' }` the service worker produces
 * during a real outage — so the drill exercises the real classification, the
 * real outbox, the real retry accounting and the real bar. It does not patch
 * `window.fetch`, so reads (the lice queue, the heartbeat) keep working.
 *
 * That scope is deliberate and it is a limitation worth stating plainly: during
 * a drill the organiser's Live board still sees this tablet as healthy, because
 * the heartbeat is still POSTing. The drill teaches the referee what their own
 * screen does when hits stop leaving; it is not a full network partition and
 * must not be described as one.
 *
 * ── Why it cannot corrupt anything ──────────────────────────────────────────
 *
 * A 503 is a RETRYABLE failure. It never reaches the 400 branch, so it can
 * never quarantine — a drill must not put a fake refusal in the operator's
 * inbox, and `requeueRejected` re-derives sequence numbers, which has no
 * business happening because of a practice run. Every hit scored during the
 * drill is a genuine queued hit and drains for real when the window ends.
 *
 * ── Why localStorage and useSyncExternalStore ───────────────────────────────
 *
 * The end time is an ABSOLUTE timestamp so a reload mid-drill resumes the
 * remaining window rather than silently ending it — a crew member who reloads
 * because they think the tablet is broken is exactly the person the drill is
 * for. And `react-hooks/set-state-in-effect` is an ERROR in this app, so the
 * read-then-setState shape does not survive lint; this follows `last-event.ts`,
 * which established the pattern here for the same reason.
 */

const STORAGE_KEY = 'myclash.staff.offlineDrill.v1';

/**
 * Two minutes.
 *
 * Long enough to score several hits, watch the counter climb, reload the page
 * and see the queue survive — the three things the drill exists to teach.
 * Short enough that starting one by accident before a bout is not a problem,
 * which matters more than the exact number: there is always an abort.
 */
export const DRILL_DURATION_MS = 120_000;

const listeners = new Set<() => void>();

/**
 * Mirrors localStorage so `isDrillActive()` is a synchronous, allocation-free
 * read. `SyncEngine` calls it on the hot path — once per exchange POST — and
 * touching localStorage there would be a needless synchronous main-thread hit
 * while a referee is scoring.
 */
let endsAt = 0;

/** Whether the drill is running. Pure — `now` is a parameter so it is testable. */
export function isDrillActiveAt(endsAtMs: number, now: number): boolean {
  return endsAtMs > now;
}

/** Milliseconds left, floored at zero. Pure. */
export function drillRemainingMs(endsAtMs: number, now: number): number {
  return Math.max(0, endsAtMs - now);
}

/**
 * Should a drill be allowed to start?
 *
 * Refused while anything is already queued or held. Starting a drill on top of
 * a genuine sync problem would mix real and simulated failure in one bar, and
 * the operator would have no way to tell which hits were which.
 */
export function canStartDrill(pendingCount: number, rejectedCount: number): boolean {
  return pendingCount === 0 && rejectedCount === 0;
}

function readStored(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Private browsing. No drill rather than a broken page.
    return 0;
  }
}

function write(value: number): void {
  endsAt = value;
  if (typeof window !== 'undefined') {
    try {
      if (value > 0) window.localStorage.setItem(STORAGE_KEY, String(value));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort: an in-memory drill still works, it just will not survive
      // a reload.
    }
  }
  for (const listener of listeners) listener();
}

// Hydrate the mirror on first import, so a reload mid-drill resumes rather than
// starting the tablet in a state that disagrees with what is on screen.
if (typeof window !== 'undefined') endsAt = readStored();

/** Start a drill window from now. */
export function startOfflineDrill(now = Date.now()): void {
  write(now + DRILL_DURATION_MS);
}

/**
 * End it early.
 *
 * Always available. A drill with no abort in a live hall is a hazard — the
 * whole point is that the crew is holding a tablet that is deliberately
 * refusing to sync, and a real match can start at any moment.
 */
export function endOfflineDrill(): void {
  write(0);
}

/**
 * Is the drill running right now?
 *
 * The one function `SyncEngine` calls. Self-expiring: once the window passes it
 * reports false without anything having to fire a timer, so a tablet left
 * asleep through the end of a drill wakes up syncing normally.
 */
export function isDrillActive(now = Date.now()): boolean {
  return isDrillActiveAt(endsAt, now);
}

/** Absolute end timestamp, 0 when no drill is set. */
export function drillEndsAt(): number {
  return endsAt;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // `storage` fires only in OTHER tabs; the local set covers this one.
  if (typeof window !== 'undefined') window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', callback);
  };
}

function getSnapshot(): number {
  return endsAt;
}

function getServerSnapshot(): number {
  return 0;
}

/** The drill's end timestamp, or 0. Re-renders subscribers when it changes. */
export function useOfflineDrillEndsAt(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
