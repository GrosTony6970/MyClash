import type { StatusSemantic } from '@myclash/ui';
import type { GearEntry } from './useGear';

/**
 * Where one fighter stands at the gear table, across every weapon they fight.
 *
 * A result is recorded PER WEAPON, so a fighter entered in longsword and rapier
 * has two independent results — and the gear table still has to put that person
 * in exactly one place. Worst result wins:
 *
 *     fail > conditional > unchecked > pass
 *
 * `unchecked` outranks `pass` deliberately. A fighter with a passed longsword
 * and an unchecked rapier still needs someone's attention, and the Pass tab
 * means "every weapon passed" — the same bar the old checked/total counter used,
 * because a longsword pass says nothing about the rapier they fight with after
 * lunch.
 *
 * Pure on purpose: no React, no fetch. The parity between a tab's count and its
 * rows is only testable if both sides of it live here.
 */

export type GearStanding = 'fail' | 'conditional' | 'unchecked' | 'pass';

export const GEAR_TABS = ['all', 'unchecked', 'pass', 'conditional', 'fail'] as const;
export type GearTab = (typeof GEAR_TABS)[number];

export type GearCounts = Record<GearTab, number>;

/** Worst first. The index IS the precedence. */
const BY_SEVERITY: readonly GearStanding[] = ['fail', 'conditional', 'unchecked', 'pass'];

/**
 * `StatusBadge` takes one of seven canonical semantics, never free text.
 *
 * Conditional and unchecked must not share one — they would paint the same
 * colour on the screen built to tell them apart.
 */
const SEMANTIC: Record<GearStanding, StatusSemantic> = {
  fail: 'danger',
  conditional: 'paused',
  unchecked: 'pending',
  pass: 'done',
};

export function standingSemantic(standing: GearStanding): StatusSemantic {
  return SEMANTIC[standing];
}

/**
 * One fighter's standing.
 *
 * A fighter whose weapon name never resolved to a catalog entry has no weapon
 * lines at all, and lands in `unchecked`: nobody has checked them, and they are
 * exactly who the gear table needs to notice.
 */
export function standingFor(entry: GearEntry): GearStanding {
  if (entry.weapons.length === 0) return 'unchecked';
  const held = new Set<GearStanding>(entry.weapons.map((weapon) => weapon.result ?? 'unchecked'));
  return BY_SEVERITY.find((standing) => held.has(standing)) ?? 'pass';
}

/** How many fighters each tab holds. Event-wide, because the roster is. */
export function countsByStanding(entries: readonly GearEntry[]): GearCounts {
  const counts: GearCounts = {
    all: entries.length,
    unchecked: 0,
    pass: 0,
    conditional: 0,
    fail: 0,
  };
  for (const entry of entries) counts[standingFor(entry)] += 1;
  return counts;
}

/** Below two characters a name search matches most of the roster. */
const MIN_QUERY = 2;

export function matchesQuery(entry: GearEntry, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term.length < MIN_QUERY) return true;
  const person = entry.person;
  return `${person.givenName} ${person.familyName}`.toLowerCase().includes(term);
}

/** The rows one tab renders. Tab and search both apply. */
export function visibleGear(
  entries: readonly GearEntry[],
  tab: GearTab,
  query: string,
): GearEntry[] {
  return entries.filter(
    (entry) => (tab === 'all' || standingFor(entry) === tab) && matchesQuery(entry, query),
  );
}

/** How many fighters the search matches across the whole roster, whatever the tab. */
export function countMatchingQuery(entries: readonly GearEntry[], query: string): number {
  return entries.filter((entry) => matchesQuery(entry, query)).length;
}
