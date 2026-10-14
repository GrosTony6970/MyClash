import { fuzzyMatch } from '@myclash/ui';

/** The candidates whose name or club holds every word of `query`, accents ignored (O9). */
export function filterCandidates<C extends { displayName: string; clubLabel: string | null }>(
  candidates: C[],
  query: string,
): C[] {
  return candidates.filter((c) => fuzzyMatch(query, `${c.displayName} ${c.clubLabel ?? ''}`));
}
