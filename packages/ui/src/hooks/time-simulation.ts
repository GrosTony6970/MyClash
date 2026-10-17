import type { PublicFeatureFlagsSnapshot } from '@myclash/feature-flags';

/**
 * The API's clock minus this browser's, from a snapshot's `serverNowIso`.
 * The server stamped it somewhere between the request leaving and the answer
 * arriving, so it is read against the midpoint; the error is half a round
 * trip. 0 when the server time does not parse (an API older than the field).
 */
export function clockSkewMs(serverNowIso: string, sentAtMs: number, receivedAtMs: number): number {
  const serverMs = Date.parse(serverNowIso);
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - (sentAtMs + receivedAtMs) / 2;
}

/**
 * Epoch-ms offset to add to this browser's clock when a super-admin time
 * simulation is active. The simulation stores the datetime it should read as
 * "now" (`simulatedNowIso`) plus the server instant it was saved
 * (`anchorRealIso`). Their difference shifts server time, and `skewMs` (see
 * `clockSkewMs`) turns this browser's clock into server time, so the
 * simulated clock advances with real time from the set point and reads the
 * same on every device.
 *
 * Returns 0 (real time) when the simulation is disabled, incomplete, or
 * carries unparseable timestamps — a safe no-op fallback.
 */
export function timeSimulationOffsetMs(
  sim: PublicFeatureFlagsSnapshot['timeSimulation'],
  skewMs: number,
): number {
  if (!isTimeSimulationActive(sim)) return 0;
  return Date.parse(sim.simulatedNowIso!) - Date.parse(sim.anchorRealIso!) + skewMs;
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
