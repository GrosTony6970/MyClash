import type { ConnectorEdge } from './BracketConnectors';
import type { BracketSlotData } from './types';

/**
 * Per-slot vertical-position computation for the bracket layout.
 *
 * The classic bracket alignment puts every child slot at the
 * **vertical midpoint of its two parent slots** so the operator's
 * eye can trace the path from the first-round cards up through the
 * final. `flex justify-around` only produces that effect when the
 * first-round count is a power of 2; the moment a play-in round or
 * a bye-padded first main round shows up (e.g. 14-fighter →
 * 7 play-ins → 4 QF), uniform distribution breaks.
 *
 * Algorithm:
 *   1. Anchor round (earliest round we have) — uniform pitch.
 *   2. Each later round, per slot: average of its parents' centers.
 *   3. Orphan slots (no parents — typically seeded-bye round-1
 *      slots) get uniform spacing across the column height.
 *
 * Pure: no React, no DOM. Co-located with the edge-pairing helper
 * because both consume the same `edges` shape.
 */

export interface ComputeSlotPositionsResult {
  /** Map of slot id → vertical center in pixels. */
  positions: Map<string, number>;
  /** Column height in pixels — anchored to the first round's count. */
  columnHeight: number;
}

export function computeSlotPositions(
  slotsByRound: Map<number, BracketSlotData[]>,
  roundNumbers: readonly number[],
  edges: readonly ConnectorEdge[],
  pitchPx: number,
): ComputeSlotPositionsResult {
  const positions = new Map<string, number>();

  if (roundNumbers.length === 0) {
    return { positions, columnHeight: Math.max(0, 200) };
  }

  // 1. Anchor round — uniform pitch.
  const firstRound = roundNumbers[0]!;
  const anchorSlots = slotsByRound.get(firstRound) ?? [];
  anchorSlots.forEach((slot, i) => {
    positions.set(slot.id, (i + 0.5) * pitchPx);
  });

  const columnHeight = Math.max(anchorSlots.length * pitchPx, 200);

  // 2. Each later round: parent midpoint, falling back to uniform
  //    spacing for orphan slots.
  for (let r = 1; r < roundNumbers.length; r++) {
    const round = roundNumbers[r]!;
    const slots = slotsByRound.get(round) ?? [];
    const orphans: BracketSlotData[] = [];
    for (const slot of slots) {
      const parentCenters: number[] = [];
      for (const edge of edges) {
        if (edge.to !== slot.id) continue;
        if (edge.kind === 'bronze') continue;
        const parentCenter = positions.get(edge.from);
        if (parentCenter != null) parentCenters.push(parentCenter);
      }
      if (parentCenters.length > 0) {
        const sum = parentCenters.reduce((a, b) => a + b, 0);
        positions.set(slot.id, sum / parentCenters.length);
      } else {
        orphans.push(slot);
      }
    }
    // Distribute orphans evenly across the column so they don't
    // pile at the top.
    if (orphans.length > 0) {
      const span = columnHeight / orphans.length;
      orphans.forEach((slot, i) => {
        positions.set(slot.id, (i + 0.5) * span);
      });
    }
  }

  return { positions, columnHeight };
}
