/**
 * Round a duration (minutes) UP to the next 30-minute boundary, so a
 * pool/round block always occupies a clean half-hour span on the grid
 * (e.g. 1h45 of fights → a 2h block) even if the last fight finishes
 * early. Non-positive input → 0.
 *
 * Pure: no React, no I/O.
 */
export function roundUpToHalfHourMin(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 30) * 30;
}
