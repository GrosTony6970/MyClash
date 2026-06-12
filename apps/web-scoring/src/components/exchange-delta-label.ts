/**
 * Delta suffix for an exchange-history row. Scoring exchange types
 * (clean / afterblow) always show their delta — INCLUDING `+0` for a
 * 1-1 afterblow, so a no-point exchange still visibly registers in the
 * history (the old falsy check hid it and the row read as unrecorded).
 * Doubles and no-exchanges carry their own type label instead; legacy
 * rows without a delta show nothing.
 *
 * Pure: no React, no I/O.
 */
export function exchangeDeltaLabel(
  type: 'clean' | 'afterblow' | 'double' | 'no_exchange',
  scoreDelta: number | null | undefined,
): string | null {
  if (type !== 'clean' && type !== 'afterblow') return null;
  if (scoreDelta == null) return null;
  return `+${scoreDelta}`;
}
