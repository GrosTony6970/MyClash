/**
 * Map a referee-assigner rejection code (snake_case, emitted by
 * packages/rulesets/src/scheduling/referee-assigner.ts) to a human-readable
 * string via i18n. Unknown codes fall through to the raw code so the
 * operator still sees something rather than nothing — and so an
 * untranslated new code shows up in QA.
 */
const KNOWN_CODES = new Set([
  'no_qualified_users',
  'all_qualified_already_assigned_to_pool',
  'all_qualified_are_fighters_in_this_pool',
  'all_qualified_have_time_conflict_with_other_pool',
  'all_qualified_fighting_in_parallel_pool',
  'no_candidates_after_scoring',
  'all_qualified_unavailable_for_this_pool',
]);

export function formatUnassignedReason(code: string, t: (key: string) => string): string {
  if (KNOWN_CODES.has(code)) {
    return t(`organizer.refereesPage.unassignedReasons.${code}`);
  }
  return code;
}
