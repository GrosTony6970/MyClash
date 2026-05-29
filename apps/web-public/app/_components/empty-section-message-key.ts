/**
 * Pick the i18n key for a section's empty-state message based on
 * whether the user has typed a search. Live / Upcoming / Past each
 * get their own pair of keys (generic empty vs "no match for query").
 *
 * Pure helper — feeds the EventsListSections render and keeps the
 * branching out of the React component so it can be unit-tested.
 */

export type SectionKey = 'live' | 'upcoming' | 'past';

const GENERIC: Record<SectionKey, string> = {
  live: 'publicApp.home.emptyLive',
  upcoming: 'publicApp.home.emptyUpcoming',
  past: 'publicApp.home.emptyPast',
};

const NO_MATCH: Record<SectionKey, string> = {
  live: 'publicApp.home.emptyLiveNoMatch',
  upcoming: 'publicApp.home.emptyUpcomingNoMatch',
  past: 'publicApp.home.emptyPastNoMatch',
};

export function emptySectionMessageKey(sectionKey: SectionKey, query: string): string {
  return query.trim() === '' ? GENERIC[sectionKey] : NO_MATCH[sectionKey];
}
