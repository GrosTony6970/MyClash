import type { RosterEntry } from './useDesk';

/**
 * What the check-in desk shows, decided in the browser.
 *
 * The desk fetches the whole event roster once and then searches, filters and
 * counts it here. That is not an optimisation — it is what makes a tab reading
 * "Not arrived (63)" honest, because the count and the rows behind it come from
 * one list. A server-side filter would put them on two different answers.
 *
 * Pure on purpose: no React, no fetch. The parity between a tab's count and its
 * rows is the claim this whole screen rests on, and it is only testable if both
 * sides of it live here.
 */

export type DeskTab = 'all' | 'arrived' | 'notArrived';

export const DESK_TABS: readonly DeskTab[] = ['all', 'arrived', 'notArrived'];

export interface DeskCounts {
  all: number;
  arrived: number;
  notArrived: number;
}

/** Below two characters a name search matches most of the roster. */
const MIN_QUERY = 2;

function inTab(person: RosterEntry, tab: DeskTab): boolean {
  if (tab === 'all') return true;
  return tab === 'arrived' ? person.arrived : !person.arrived;
}

/** How many people each tab holds. Event-wide, because the roster is. */
export function countsByTab(roster: readonly RosterEntry[]): DeskCounts {
  const arrived = roster.filter((person) => person.arrived).length;
  return { all: roster.length, arrived, notArrived: roster.length - arrived };
}

/**
 * Not-arrived fighters, most urgent first.
 *
 * Ordered by when they next fight, because urgency is the entire question that
 * tab answers — alphabetical would bury the person due on Lice 3 in twelve
 * minutes behind eleven people who fight this afternoon.
 *
 * Fighters with no scheduled bout sort LAST rather than being filtered out.
 * They are still missing; they are just not yet costing anyone time, and
 * dropping them would quietly shrink a count the desk is trusted to have
 * complete.
 */
export function orderBySoonest(entries: readonly RosterEntry[]): RosterEntry[] {
  return [...entries].sort((a, b) => {
    const aAt = a.next?.scheduledAt ?? null;
    const bAt = b.next?.scheduledAt ?? null;
    if (aAt && bAt) return aAt.localeCompare(bAt) || compareByName(a, b);
    if (aAt) return -1;
    if (bAt) return 1;
    // Both unscheduled: a stable, human order so the tail of the list does not
    // reshuffle on every refetch.
    return compareByName(a, b);
  });
}

export function orderByName(entries: readonly RosterEntry[]): RosterEntry[] {
  return [...entries].sort(compareByName);
}

/** Does this person's name match what the volunteer typed? */
export function matchesQuery(person: RosterEntry, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term.length < MIN_QUERY) return true;
  return `${person.givenName} ${person.familyName}`.toLowerCase().includes(term);
}

/**
 * The rows one tab renders, in that tab's order.
 *
 * Tab and search BOTH apply. A volunteer who has typed a name and sees nothing
 * is told how many people match in All and offered the tap that switches — see
 * `countMatchingQuery`.
 */
export function visibleRoster(
  roster: readonly RosterEntry[],
  tab: DeskTab,
  query: string,
): RosterEntry[] {
  const matched = roster.filter((person) => inTab(person, tab) && matchesQuery(person, query));
  // Urgency is why the Not-arrived tab replaced a separate screen; every other
  // tab keeps the roster's own alphabetical order.
  return tab === 'notArrived' ? orderBySoonest(matched) : orderByName(matched);
}

/** How many people the search matches across the whole roster, whatever the tab. */
export function countMatchingQuery(roster: readonly RosterEntry[], query: string): number {
  return roster.filter((person) => matchesQuery(person, query)).length;
}

function compareByName(a: RosterEntry, b: RosterEntry): number {
  return a.familyName.localeCompare(b.familyName) || a.givenName.localeCompare(b.givenName);
}
