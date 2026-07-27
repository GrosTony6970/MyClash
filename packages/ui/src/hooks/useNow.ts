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

// ── Shared minute clock ───────────────────────────────────────────────────────
// One module-scoped tick store for the whole app: every consumer shares a single
// timer and re-renders together. `useSyncExternalStore` rather than setState in
// an effect, because web-public and web-admin both run
// `react-hooks/set-state-in-effect` at max-warnings 0.
//
// The server snapshot is 0 so SSR and the first client paint agree; callers that
// server-render substitute their own seed (see `useClientClock`).
const TICK_MS = 30_000;

let clockMs = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(cb: () => void): () => void {
  clockListeners.add(cb);
  if (clockTimer === null) {
    clockMs = Date.now();
    clockTimer = setInterval(() => {
      clockMs = Date.now();
      clockListeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

const getClockMs = (): number => clockMs;
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
  const base = useSyncExternalStore(subscribeClock, getClockMs, getServerClockMs);
  const { offset, simulated } = useSimulation(apiUrl);
  return { nowMs: base === 0 ? 0 : base + offset, simulated };
}

/**
 * Clock for client-only components (never server-rendered), which can read the
 * real time straight away instead of waiting for the store's first tick.
 */
export function useClock(apiUrl: string): ClockState {
  const base = useSyncExternalStore(subscribeClock, getClockMs, getServerClockMs);
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
