import type { PublicFeatureFlagsSnapshot } from '@myclash/feature-flags';

/**
 * Epoch-ms offset to add to the real clock when a super-admin time
 * simulation is active. The simulation stores the datetime it should
 * read as "now" (`simulatedNowIso`) plus the real instant it was saved
 * (`anchorRealIso`); the offset is their difference, so the simulated
 * clock advances with real time from the set point.
 *
 * Returns 0 (real time) when the simulation is disabled, incomplete, or
 * carries unparseable timestamps — a safe no-op fallback.
 */
export function timeSimulationOffsetMs(sim: PublicFeatureFlagsSnapshot['timeSimulation']): number {
  if (!isTimeSimulationActive(sim)) return 0;
  return Date.parse(sim.simulatedNowIso!) - Date.parse(sim.anchorRealIso!);
}

/**
 * Whether a simulation is actually driving the clock — enabled, with both
 * timestamps present and parseable.
 *
 * Deliberately not derived from `timeSimulationOffsetMs(sim) !== 0`:
 * simulating to roughly the present is a legitimate near-zero offset, and
 * callers use this to decide whether live *data* can be trusted (see the
 * fight rule in the personal schedule), not just how far the clock moved.
 */
export function isTimeSimulationActive(sim: PublicFeatureFlagsSnapshot['timeSimulation']): boolean {
  if (!sim.enabled || !sim.simulatedNowIso || !sim.anchorRealIso) return false;
  return (
    !Number.isNaN(Date.parse(sim.simulatedNowIso)) && !Number.isNaN(Date.parse(sim.anchorRealIso))
  );
}
