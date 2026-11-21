'use client';

import { useSyncExternalStore } from 'react';
import { useRuntimeFlags } from './useRuntimeFlags';
import { isTimeSimulationActive, isTimeSimulationFrozen, simulatedNowMs } from './time-simulation';

/** The current clock, plus whether a super-admin simulation is driving it. */
export interface ClockState {
  /** Epoch ms, already shifted (or held) by any active time simulation. */
  nowMs: number;
  /** True when the `time_simulation` flag is active — so `nowMs` is not wall-clock. */
  simulated: boolean;
  /** True when that simulation holds the clock still — so `nowMs` does not advance. */
  frozen: boolean;
  /**
   * The server's REAL clock as this browser best knows it (its own clock plus
   * the skew the flags snapshot measured), never simulated. For ages of things
   * the server stamped with its real clock — a tablet's last check-in — which a
   * simulated "now" would measure as months old, or as never ageing when frozen.
   */
  serverNowMs: number;
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

interface Simulation {
  /** This browser's clock → what "now" reads under the simulation. */
  toNow: (realMs: number) => number;
  /** Server clock minus this browser's (see `serverSkewMs`); 0 until the snapshot lands. */
  skewMs: number;
  simulated: boolean;
  frozen: boolean;
}

const REAL_TIME: Simulation = {
  toNow: (realMs) => realMs,
  skewMs: 0,
  simulated: false,
  frozen: false,
};

/** The simulation from the shared runtime-flags snapshot. */
function useSimulation(apiUrl: string): Simulation {
  const flags = useRuntimeFlags(apiUrl);
  if (!flags) return REAL_TIME;
  return {
    toNow: (realMs) => simulatedNowMs(flags.timeSimulation, realMs, flags.serverSkewMs),
    skewMs: flags.serverSkewMs,
    simulated: isTimeSimulationActive(flags.timeSimulation),
    frozen: isTimeSimulationFrozen(flags.timeSimulation),
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
  const { toNow, skewMs, simulated, frozen } = useSimulation(apiUrl);
  const serverNowMs = base === 0 ? 0 : base + skewMs;
  return { nowMs: base === 0 ? 0 : toNow(base), simulated, frozen, serverNowMs };
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
  const { toNow, skewMs, simulated, frozen } = useSimulation(apiUrl);
  const realMs = base === 0 ? Date.now() : base;
  return { nowMs: toNow(realMs), simulated, frozen, serverNowMs: realMs + skewMs };
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
  const { toNow, skewMs, simulated, frozen } = useSimulation(apiUrl);
  const realMs = base === 0 ? Date.now() : base;
  return { nowMs: toNow(realMs), simulated, frozen, serverNowMs: realMs + skewMs };
}

/** `useSecondsClock` when the caller does not need the `simulated` flag. */
export function useNowSeconds(apiUrl: string): number {
  return useSecondsClock(apiUrl).nowMs;
}
