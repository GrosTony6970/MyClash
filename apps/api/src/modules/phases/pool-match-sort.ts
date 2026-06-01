/**
 * Berger labels have the shape `L{lice}-P{pool}-M{seq}`. Sorting
 * those alphabetically puts M10 before M2 — wrong for the operator's
 * Matches tab. Extract the trailing M-number numerically; fall back
 * to MAX_SAFE_INTEGER so malformed labels sink to the end.
 */
export function poolMatchSortKey(label: string | null): number {
  const match = label?.match(/-M(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
