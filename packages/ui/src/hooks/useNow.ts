'use client';

import { useSyncExternalStore } from 'react';
import { useRuntimeFlags } from './useRuntimeFlags';
import { isTimeSimulationActive, timeSimulationOffsetMs } from './time-simulation';

/** The current clock, plus whether a super-admin simulation is driving it. */
export interface ClockState {
  /** Epoch ms, already shifted by any active time simulation. */
  nowMs: number;
  /** True when the `time_simulation` flag is active — so `nowMs` is not wall-clock. */
  simulated: boolean;
}

// ── Shared tick stores ────────────────────────────────────────────────────────
// One module-scoped tick store per cadence: every consumer of a cadence shares a
// single timer and re-renders together, and the timer is torn down when the last
// listener unsubscribes. `useSyncExternalStore` rather than setState in an
// effect, because web-public and web-admin both run
// `react-hooks/set-state-in-effect` at max-warnings 0.
//
// The server snapshot is 0 so SSR and the first client paint agree; callers that
// server-render substitute their own seed (see `useClientClock`).

interface TickStore {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => number;
}

/** Build a store that republishes `Date.now()` every `tickMs`. */
function createTickStore(tickMs: number): TickStore {
  let ms = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      if (timer === null) {
        ms = Date.now();
        timer = setInterval(() => {
          ms = Date.now();
          listeners.forEach((l) => l());
        }, tickMs);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot: (): number => ms,
  };
}

/**
 * The default cadence: enough for "starts in 12 min" and countdowns, cheap
 * enough that every schedule and follow surface can subscribe.
 *
 * Do NOT lower this to get a ticking seconds readout — `useNow` has consumers
 * across web-public, and they would all re-render 30x more often for a
 * precision none of them display. Use the seconds store below instead.
 */
const TICK_MS = 30_000;

/**
 * One second, for elapsed-time readouts that must visibly advance (the live
 * control room's bout timers). Deliberately a separate store: subscribing to it
 * is an explicit opt-in to a 1 Hz re-render.
 */
const SECONDS_TICK_MS = 1_000;

const minuteStore = createTickStore(TICK_MS);
const secondsStore = createTickStore(SECONDS_TICK_MS);

const getServerClockMs = (): number => 0;

/** Offset + active flag from the shared runtime-flags snapshot. */
function useSimulation(apiUrl: string): { offset: number; simulated: boolean } {
  const flags = useRuntimeFlags(apiUrl);
  if (!flags) return { offset: 0, simulated: false };
  return {
    offset: timeSimulationOffsetMs(flags.timeSimulation),
    simulated: isTimeSimulationActive(flags.timeSimulation),
  };
}

/**
 * Hydration-safe clock for components that server-render: `nowMs` is 0 on the
 * server and on the first client paint, so the markup matches. Callers fall
 * back to their own server-passed seed while it reads 0, then get the real
 * (optionally simulated) clock once the store ticks in.
 */
export function useClientClock(apiUrl: string): ClockState {
  const base = useSyncExternalStore(
    minuteStore.subscribe,
    minuteStore.getSnapshot,
    getServerClockMs,
  );
  const { offset, simulated } = useSimulation(apiUrl);
  return { nowMs: base === 0 ? 0 : base + offset, simulated };
}

/**
 * Clock for client-only components (never server-rendered), which can read the
 * real time straight away instead of waiting for the store's first tick.
 */
export function useClock(apiUrl: string): ClockState {
  const base = useSyncExternalStore(
    minuteStore.subscribe,
    minuteStore.getSnapshot,
    getServerClockMs,
  );
  const { offset, simulated } = useSimulation(apiUrl);
  return { nowMs: (base === 0 ? Date.now() : base) + offset, simulated };
}

/**
 * Current time in epoch ms, shifted by an active super-admin time simulation
 * (client-side only — see the `time_simulation` feature flag). Advances every
 * 30 s and re-renders whenever the runtime-flags snapshot changes (e.g. the
 * simulation is toggled). Falls back to the real clock when no simulation is
 * active or the snapshot hasn't loaded yet.
 *
 * Use `useClock` instead when you also need to know whether the value is
 * simulated, or `useClientClock` when the component server-renders.
 */
export function useNow(apiUrl: string): number {
  return useClock(apiUrl).nowMs;
}

/**
 * Like `useClock`, but advancing every second instead of every 30.
 *
 * For readouts a human watches tick: elapsed time on a running bout, "late by
 * 2:14". Subscribing re-renders the calling component at 1 Hz, so subscribe
 * once high in the tree and pass `nowMs` down rather than calling this per row.
 *
 * Client-only, like `useClock` — it reads the real clock on the first paint
 * instead of waiting for the store's first tick, so it must not be used by a
 * component that server-renders.
 */
export function useSecondsClock(apiUrl: string): ClockState {
  const base = useSyncExternalStore(
    secondsStore.subscribe,
    secondsStore.getSnapshot,
    getServerClockMs,
  );
  const { offset, simulated } = useSimulation(apiUrl);
  return { nowMs: (base === 0 ? Date.now() : base) + offset, simulated };
}

/** `useSecondsClock` when the caller does not need the `simulated` flag. */
export function useNowSeconds(apiUrl: string): number {
  return useSecondsClock(apiUrl).nowMs;
}
