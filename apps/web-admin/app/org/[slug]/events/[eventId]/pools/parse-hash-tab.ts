/**
 * Extract the top-level tab from a (possibly compound) URL hash.
 *
 * Tabs may layer their own state on top of the tab key using
 * `-<inner-state>` (e.g. `#standings-by-pool`). The parent shell
 * only cares about the leading segment; this helper trims the
 * inner state before matching against the known tabs.
 *
 * Returns the matching tab key, or null when none matches — the
 * caller picks the fallback so different shells can have
 * different defaults.
 */
export function parseHashTab<TKey extends string>(
  hash: string,
  knownTabs: readonly TKey[],
): TKey | null {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const head = cleaned.split('-')[0] ?? '';
  return (knownTabs as readonly string[]).includes(head) ? (head as TKey) : null;
}
