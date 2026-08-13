/**
 * Whether the three event sections should collapse into a single empty card.
 *
 * The catalogue used to unmount its whole listing when the platform held no
 * events and no leagues: the Events/Leagues tabs, the filter bar and the
 * "Browse organisers" link all disappeared together, leaving a visitor on a
 * dead end with no way anywhere. Keeping the tabs mounted fixes that, but then
 * a brand-new platform renders three stacked "no events" messages -- one per
 * section -- which says the same thing three times.
 *
 * So: collapse to one card ONLY when the platform is genuinely empty. A
 * filtered search that matched nothing must keep its per-section messages,
 * because "no live events match 'x'" is the useful sentence there and a single
 * generic card would lose the query the reader typed.
 *
 * Pure and dependency-free, like its sibling `empty-section-message-key.ts`,
 * so the branching is testable without rendering anything.
 */
export interface SectionCounts {
  live: number;
  published: number;
  past: number;
}

export function shouldCollapseEmptySections(
  counts: SectionCounts,
  hasActiveFilter: boolean,
): boolean {
  if (hasActiveFilter) return false;
  return counts.live === 0 && counts.published === 0 && counts.past === 0;
}
