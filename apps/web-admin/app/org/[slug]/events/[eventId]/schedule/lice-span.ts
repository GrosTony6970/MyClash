/**
 * Pure helpers for the Block grid's resize interactions.
 *
 * `liceSpanFromDelta` maps a horizontal drag on a block's right edge to the new
 * set of lice column indices: a pool (single lice) relocates; a bracket round
 * spreads or narrows (its start lice is fixed, the end moves).
 *
 * `respaceMatchesEvenly` spreads a block's matches across a new time span when
 * the block is resized vertically.
 *
 * Pure: no React, no I/O.
 */

export function liceSpanFromDelta(input: {
  kind: 'pool' | 'bracket' | 'other';
  liceIndices: number[];
  deltaCols: number;
  liceCount: number;
}): number[] {
  const { kind, liceIndices, deltaCols, liceCount } = input;
  const min = liceIndices[0] ?? 0;
  if (kind === 'bracket') {
    const max = liceIndices[liceIndices.length - 1] ?? min;
    const newMax = Math.max(min, Math.min(liceCount - 1, max + deltaCols));
    const out: number[] = [];
    for (let i = min; i <= newMax; i++) out.push(i);
    return out;
  }
  // pool / other: a single-lice block relocates to one other lice.
  const next = Math.max(0, Math.min(liceCount - 1, min + deltaCols));
  return [next];
}

export function respaceMatchesEvenly(input: {
  startSlot: number;
  endSlot: number;
  count: number;
}): number[] {
  const { startSlot, endSlot, count } = input;
  if (count <= 0) return [];
  if (count === 1) return [startSlot];
  if (endSlot <= startSlot) return Array.from({ length: count }, () => startSlot);
  const step = (endSlot - startSlot) / count;
  return Array.from({ length: count }, (_, i) => startSlot + Math.floor(i * step));
}
