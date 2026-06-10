/**
 * Reserve-space layout for the schedule grid's pool headers.
 *
 * The grid is one explicit CSS grid where every item is placed at an
 * absolute `gridRow`. The pool header used to overlap the first matches
 * (it sat on the same rows). To give it its own space, we insert
 * `POOL_HEADER_SPAN` blank rows before each distinct slot where a pool
 * header starts, and shift every content item at or after that slot down
 * by the accumulated number of inserted rows. Rows are shared across
 * columns, so all columns shift together and the time axis stays aligned.
 */

/** Grid rows reserved for one pool header (~`SLOT_HEIGHT_PX` each). */
export const POOL_HEADER_SPAN = 2;

/**
 * Number of rows a content slot must shift down, given the (possibly
 * duplicated) slots where pool headers start. Each DISTINCT header-start
 * slot at or below `slot` reserves `headerSpan` rows above it.
 */
export function rowShiftForSlot(
  slot: number,
  headerStartSlots: number[],
  headerSpan: number,
): number {
  const distinctAtOrBelow = new Set(headerStartSlots.filter((s) => s <= slot));
  return headerSpan * distinctAtOrBelow.size;
}
