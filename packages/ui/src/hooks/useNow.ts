'use client';

import { useEffect, useState } from 'react';
import { useRuntimeFlags } from './useRuntimeFlags';
import { timeSimulationOffsetMs } from './time-simulation';

/**
 * Current time in epoch ms, shifted by an active super-admin time
 * simulation (client-side only — see the `time_simulation` feature
 * flag). Ticks every `intervalMs` so time-dependent UI advances, and
 * re-renders whenever the runtime-flags snapshot changes (e.g. the
 * simulation is toggled). Falls back to the real clock when no
 * simulation is active or the snapshot hasn't loaded yet.
 */
export function useNow(apiUrl: string, intervalMs = 30_000): number {
  const flags = useRuntimeFlags(apiUrl);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const offset = flags ? timeSimulationOffsetMs(flags.timeSimulation) : 0;
  return Date.now() + offset;
}
