/**
 * Column derivation for the assignments "by time slot" grid: the ordered
 * union of lice ids used by any scheduled pool, in the order the /lices
 * endpoint returned them (= the operator-configured sort_order) — NOT in
 * pool-appearance order, so columns line up across timeslot sections.
 *
 * Pure: no React, no DOM.
 */

/** Pseudo-column for scheduled pools that have no lice assigned yet. */
export const NO_LICE = '__no_lice__';

export function liceColumnsFor(
  blocks: Array<{ pools: Array<{ liceId: string | null }> }>,
  liceOrder: string[],
): string[] {
  const used = new Set<string>();
  for (const block of blocks) {
    for (const pool of block.pools) {
      used.add(pool.liceId ?? NO_LICE);
    }
  }
  const columns = liceOrder.filter((id) => used.has(id));
  if (used.has(NO_LICE)) columns.push(NO_LICE);
  return columns;
}
