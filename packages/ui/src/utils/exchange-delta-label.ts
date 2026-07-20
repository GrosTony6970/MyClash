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

import type { ExchangeType } from '../types/match-events';

export function exchangeDeltaLabel(
  type: ExchangeType,
  scoreDelta: number | null | undefined,
): string | null {
  if (type !== 'clean' && type !== 'afterblow') return null;
  if (scoreDelta == null) return null;
  return `+${scoreDelta}`;
}

/**
 * Delta the OTHER fighter (the afterblower / defender) receives on an afterblow.
 * In full-afterblow scoring the defender also scores, so the history row must
 * show both fighters' points. Returns `+N` only for an afterblow that actually
 * awarded the defender points; null otherwise (clean/double/no-exchange, or a
 * deductive afterblow where the defender scored nothing).
 *
 * Pure: no React, no I/O.
 */
export function afterblowDefenderLabel(
  type: ExchangeType,
  defenderDelta: number | null | undefined,
): string | null {
  if (type !== 'afterblow') return null;
  if (defenderDelta == null || defenderDelta <= 0) return null;
  return `+${defenderDelta}`;
}
