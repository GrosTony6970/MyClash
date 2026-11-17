/**
 * The penalty list as the pad shows it, and the entries an organiser pinned as
 * quick-pick chips.
 *
 * A ref is TEXT (`"8"`, `"R7a"`, migration 0071), so it is matched as text and
 * sorted as text read the way a person reads it: `"2"` before `"10"`.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import { comparePenaltyEntries } from '@myclash/types';
import type { PenaltyRulesetEntry } from '../hooks/usePenalties';

/** By group, then by ref: numbers in order, letters after. */
export function sortedEntries(entries: readonly PenaltyRulesetEntry[]): PenaltyRulesetEntry[] {
  return [...entries].sort(comparePenaltyEntries);
}

/** The entries whose ref the Tournament pinned (`display.quickPenalties`). */
export function quickEntriesOf(
  entries: readonly PenaltyRulesetEntry[],
  pinned: readonly string[] | undefined,
): PenaltyRulesetEntry[] {
  return entries.filter((entry) => (pinned ?? []).includes(entry.ref_number));
}

/** The entries the search finds: by name, description or ref, in any case. */
export function searchedEntries(
  entries: readonly PenaltyRulesetEntry[],
  query: string,
): readonly PenaltyRulesetEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (entry) =>
      entry.short_name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.ref_number.toLowerCase().includes(q),
  );
}
