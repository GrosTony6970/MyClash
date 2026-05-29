/**
 * Render the "Fight X / Y" segment that appears in the external
 * display header. Returns null when either the index or the total
 * is missing or invalid so the caller can drop the segment
 * entirely (bracket matches, for instance, have no pool sibling
 * count and pass null).
 */
export function formatFightOfTotal(
  index: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (index == null || total == null) return null;
  if (!Number.isFinite(index) || !Number.isFinite(total)) return null;
  if (total <= 0 || index <= 0) return null;
  return `Fight ${index} / ${total}`;
}
