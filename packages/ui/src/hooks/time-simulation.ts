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
 * What "now" reads, in epoch ms, given this browser's clock (`realMs`).
 *
 * The simulation stores the datetime it should read as "now"
 * (`simulatedNowIso`) plus the server instant it was saved (`anchorRealIso`).
 * - `frozen`: the clock stays on `simulatedNowIso`, whatever real time does.
 * - `running`: the clock advances with real time from the set point. Their
 *   difference shifts server time, and `skewMs` (see `clockSkewMs`) turns
 *   this browser's clock into server time, so it reads the same on every
 *   device.
 *
 * Returns `realMs` untouched when the simulation is disabled, incomplete, or
 * carries unparseable timestamps — a safe no-op fallback.
 */
export function simulatedNowMs(
  sim: PublicFeatureFlagsSnapshot['timeSimulation'],
  realMs: number,
  skewMs: number,
): number {
  if (!isTimeSimulationActive(sim)) return realMs;
  const simulatedMs = Date.parse(sim.simulatedNowIso!);
  if (sim.mode === 'frozen') return simulatedMs;
  return realMs + skewMs + simulatedMs - Date.parse(sim.anchorRealIso!);
}

/**
 * Whether a simulation is actually driving the clock — enabled, with a mode
 * and both timestamps present and parseable.
 *
 * Deliberately not derived from `simulatedNowMs(sim, t, 0) !== t`:
 * simulating to roughly the present is a legitimate near-zero offset, and
 * callers use this to decide whether live *data* can be trusted (see the
 * fight rule in the personal schedule), not just how far the clock moved.
 */
export function isTimeSimulationActive(sim: PublicFeatureFlagsSnapshot['timeSimulation']): boolean {
  if (!sim.enabled || !sim.simulatedNowIso || !sim.anchorRealIso || !sim.mode) return false;
  return (
    !Number.isNaN(Date.parse(sim.simulatedNowIso)) && !Number.isNaN(Date.parse(sim.anchorRealIso))
  );
}

/** Whether an active simulation holds the clock still. */
export function isTimeSimulationFrozen(sim: PublicFeatureFlagsSnapshot['timeSimulation']): boolean {
  return isTimeSimulationActive(sim) && sim.mode === 'frozen';
}
