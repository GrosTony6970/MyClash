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
  if (!sim.enabled || !sim.simulatedNowIso || !sim.anchorRealIso) return 0;
  const target = Date.parse(sim.simulatedNowIso);
  const anchor = Date.parse(sim.anchorRealIso);
  if (Number.isNaN(target) || Number.isNaN(anchor)) return 0;
  return target - anchor;
}
