// The simulation's math has one copy, in `@myclash/feature-flags`: the API's clock reads it too.
export {
  simulatedNowMs,
  isTimeSimulationActive,
  isTimeSimulationFrozen,
} from '@myclash/feature-flags';

/**
 * The API's clock minus this browser's, from a snapshot's `serverNowIso`.
 * The server stamped it somewhere between the request leaving and the answer
 * arriving, so it is read against the midpoint; the error is half a round
 * trip.
 *
 * 0 when the server time does not parse — an API that answered without the
 * field, which only a half-done deploy produces. This browser then runs on
 * its own clock, so it says so in the console rather than drift unseen.
 */
export function serverSkewMs(serverNowIso: string, sentAtMs: number, receivedAtMs: number): number {
  const serverMs = Date.parse(serverNowIso);
  if (Number.isNaN(serverMs)) {
    console.warn(
      `[time-simulation] the flags snapshot carried no usable serverNowIso (${String(serverNowIso)}); this browser runs on its own clock`,
    );
    return 0;
  }
  return serverMs - (sentAtMs + receivedAtMs) / 2;
}
