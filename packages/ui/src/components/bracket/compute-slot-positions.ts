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
 * 7 play-ins → 4 QF, or 18-fighter → 2 play-ins → 8 R1), uniform
 * distribution breaks.
 *
 * Algorithm:
 *   1. Anchor on the **widest round** (most slots; tie → earliest) —
 *      uniform pitch. The widest round defines the column height; a
 *      play-in round is narrower than the first main round, so the
 *      old "anchor on roundNumbers[0]" crushed the main round into
 *      the play-in round's height and the cards overlapped.
 *   2. Forward (rounds after the anchor): each slot at the average of
 *      its parents' centers (`edge.to === slot.id`).
 *   3. Backward (rounds before the anchor, e.g. play-ins): each slot
 *      at the center of the child it feeds (`edge.from === slot.id`).
 *   4. Orphans / colliding children fall back to uniform spacing
 *      across the column height so cards never overlap.
 *
 * Pure: no React, no DOM. Co-located with the edge-pairing helper
 * because both consume the same `edges` shape.
 */

export interface ComputeSlotPositionsResult {
  /** Map of slot id → vertical center in pixels. */
  positions: Map<string, number>;
  /** Column height in pixels — anchored to the widest round's count. */
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

  // 1. Anchor on the widest round — uniform pitch.
  let anchorIdx = 0;
  let maxCount = -1;
  for (let r = 0; r < roundNumbers.length; r++) {
    const count = (slotsByRound.get(roundNumbers[r]!) ?? []).length;
    if (count > maxCount) {
      maxCount = count;
      anchorIdx = r;
    }
  }
  const anchorSlots = slotsByRound.get(roundNumbers[anchorIdx]!) ?? [];
  anchorSlots.forEach((slot, i) => {
    positions.set(slot.id, (i + 0.5) * pitchPx);
  });
  const columnHeight = Math.max(anchorSlots.length * pitchPx, 200);

  // Distribute a round's slots evenly across the column height — the
  // fallback when relationship-based placement isn't possible.
  const distributeEvenly = (slots: BracketSlotData[]) => {
    if (slots.length === 0) return;
    const span = columnHeight / slots.length;
    slots.forEach((slot, i) => positions.set(slot.id, (i + 0.5) * span));
  };

  // 2. Forward — rounds after the anchor sit at their parents' midpoint.
  for (let r = anchorIdx + 1; r < roundNumbers.length; r++) {
    const slots = slotsByRound.get(roundNumbers[r]!) ?? [];
    const orphans: BracketSlotData[] = [];
    for (const slot of slots) {
      const parentCenters: number[] = [];
      for (const edge of edges) {
        if (edge.to !== slot.id || edge.kind === 'bronze') continue;
        const c = positions.get(edge.from);
        if (c != null) parentCenters.push(c);
      }
      if (parentCenters.length > 0) {
        positions.set(slot.id, parentCenters.reduce((a, b) => a + b, 0) / parentCenters.length);
      } else {
        orphans.push(slot);
      }
    }
    distributeEvenly(orphans);
  }

  // 3. Backward — rounds before the anchor (play-ins) align to the
  //    child each slot feeds. If two slots would land on the same
  //    center (e.g. refs absent and position-pairing collapsed them)
  //    or any slot has no child, distribute the whole round evenly so
  //    nothing overlaps.
  for (let r = anchorIdx - 1; r >= 0; r--) {
    const slots = slotsByRound.get(roundNumbers[r]!) ?? [];
    const candidate = new Map<string, number>();
    let safe = true;
    for (const slot of slots) {
      const childCenters: number[] = [];
      for (const edge of edges) {
        if (edge.from !== slot.id || edge.kind === 'bronze') continue;
        const c = positions.get(edge.to);
        if (c != null) childCenters.push(c);
      }
      if (childCenters.length === 0) {
        safe = false;
        break;
      }
      candidate.set(slot.id, childCenters.reduce((a, b) => a + b, 0) / childCenters.length);
    }
    if (safe && new Set(candidate.values()).size === candidate.size) {
      for (const [id, c] of candidate) positions.set(id, c);
    } else {
      distributeEvenly(slots);
    }
  }

  return { positions, columnHeight };
}
