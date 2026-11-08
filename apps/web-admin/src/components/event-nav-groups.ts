import { useSyncExternalStore } from 'react';
import type { OrgMenuProfile } from '@myclash/types';
import type { NavIconName } from '@myclash/ui';

/**
 * The event-scoped section of the organiser sidebar (the organisation section is ./org-nav-items),
 * and the rule that decides what a club's menu profile shows. The event entries are split into four
 * collapsible themed groups; "Event overview" stays ungrouped at the top (rendered directly under
 * the event switcher in {@link OrganizerAdminShell}).
 *
 * The taxonomy lives here (not inline in the shell) so it can be unit-tested
 * — see event-nav-groups.test.ts, which guards against dropping/duplicating a
 * route and asserts every heading key resolves in both locales.
 */
export interface EventNavItem {
  readonly href: string;
  readonly labelKey: string;
  /**
   * Semantic slug resolved to a glyph by `<NavIcon>` at render time — this
   * file stays pure data (no JSX) so its unit test can import it in a plain
   * node environment.
   */
  readonly icon: NavIconName;
  /**
   * Does the entry show when the organisation picks "Workshops only"? Required, so a new entry
   * cannot be added without deciding: the type check refuses one that does not say. The entry is
   * the one owner of this answer; there is no separate hidden list.
   */
  readonly inWorkshops: boolean;
}

export interface EventNavGroup {
  readonly key: string;
  readonly headingKey: string;
  readonly items: readonly EventNavItem[];
}

export const EVENT_NAV_OVERVIEW: EventNavItem = {
  href: '',
  labelKey: 'organizer.shell.nav.eventOverview',
  icon: 'eventOverview',
  inWorkshops: true,
};

export const EVENT_NAV_GROUPS: readonly EventNavGroup[] = [
  {
    key: 'people',
    headingKey: 'organizer.shell.eventGroups.people',
    items: [
      {
        href: 'persons',
        labelKey: 'organizer.eventHub.sections.persons',
        icon: 'persons',
        inWorkshops: true,
      },
      { href: 'clubs', labelKey: 'organizer.shell.nav.clubs', icon: 'clubs', inWorkshops: true },
      {
        href: 'referees',
        labelKey: 'organizer.eventHub.sections.referees',
        icon: 'referees',
        inWorkshops: false,
      },
      {
        href: 'staff',
        labelKey: 'organizer.eventHub.sections.staff',
        icon: 'staff',
        inWorkshops: true,
      },
    ],
  },
  {
    key: 'competition',
    headingKey: 'organizer.shell.eventGroups.competition',
    items: [
      // Before Live because that is the order of the day: work the checklist
      // down, then run the event. It is the readiness report re-read as a
      // sequence, not a second source of truth.
      {
        href: 'day',
        labelKey: 'organizer.startOfDay.navLabel',
        icon: 'startOfDay',
        inWorkshops: false,
      },
      {
        href: 'live',
        labelKey: 'organizer.eventHub.sections.live',
        icon: 'live',
        inWorkshops: false,
      },
      {
        href: 'tournaments',
        labelKey: 'organizer.shell.nav.tournaments',
        icon: 'tournaments',
        inWorkshops: false,
      },
      {
        href: 'pools',
        labelKey: 'organizer.eventHub.sections.pools',
        icon: 'pools',
        inWorkshops: false,
      },
      // Between Pools and Bracket because that is where the phase runs:
      // pools -> Swiss -> bracket is a valid three-stage tournament.
      {
        href: 'swiss',
        labelKey: 'organizer.eventHub.sections.swiss',
        icon: 'swiss',
        inWorkshops: false,
      },
      {
        href: 'bracket',
        labelKey: 'organizer.eventHub.sections.bracket',
        icon: 'bracket',
        inWorkshops: false,
      },
      {
        href: 'finalranking',
        labelKey: 'organizer.eventHub.sections.finalRanking',
        icon: 'finalRanking',
        inWorkshops: false,
      },
      // Sits with the results rather than with the exports on the archive page:
      // organisers reach for it straight after the final ranking is settled.
      {
        href: 'hema-ratings',
        labelKey: 'organizer.eventHub.sections.hemaRatings',
        icon: 'ratings',
        inWorkshops: false,
      },
      // Second-black-card disqualification review queue (write-only state
      // machine before this page existed — the DQ rule never enforced).
      {
        href: 'penalties',
        labelKey: 'organizer.eventHub.sections.penalties',
        icon: 'penalties',
        inWorkshops: false,
      },
      // Kept in Workshops only, where it moves to Programme (WORKSHOPS_MOVES).
      {
        href: 'schedule',
        labelKey: 'organizer.eventHub.sections.schedule',
        icon: 'schedule',
        inWorkshops: true,
      },
      {
        href: 'statistics',
        labelKey: 'organizer.eventHub.sections.statistics',
        icon: 'statistics',
        inWorkshops: false,
      },
      // Beside the results it qualifies: the report says whether the timings
      // attached to them can be trusted.
      {
        href: 'clock',
        labelKey: 'organizer.clockReport.navLabel',
        icon: 'clockReport',
        inWorkshops: false,
      },
      // Reads the same day from the other end: the clock report qualifies the
      // results, this one says what never arrived to be qualified.
      {
        href: 'debrief',
        labelKey: 'organizer.debrief.navLabel',
        icon: 'auditLog',
        inWorkshops: false,
      },
    ],
  },
  {
    key: 'programme',
    headingKey: 'organizer.shell.eventGroups.programme',
    items: [
      {
        href: 'workshops',
        labelKey: 'organizer.eventHub.sections.workshops',
        icon: 'workshops',
        inWorkshops: true,
      },
    ],
  },
  {
    key: 'admin',
    headingKey: 'organizer.shell.eventGroups.admin',
    items: [
      // None of its pages refer to Workshops or instructors.
      {
        href: 'compensation',
        labelKey: 'organizer.eventHub.sections.compensation',
        icon: 'compensation',
        inWorkshops: false,
      },
      {
        href: 'notifications',
        labelKey: 'organizer.eventHub.sections.notifications',
        icon: 'notifications',
        inWorkshops: true,
      },
      {
        href: 'photos',
        labelKey: 'organizer.eventHub.sections.photos',
        icon: 'photos',
        inWorkshops: true,
      },
      {
        href: 'theme',
        labelKey: 'organizer.eventHub.sections.theme',
        icon: 'theme',
        inWorkshops: true,
      },
      {
        href: 'archive',
        labelKey: 'organizer.archive.navLabel',
        icon: 'archive',
        inWorkshops: true,
      },
      {
        href: 'ai-assistant',
        labelKey: 'organizer.eventHub.sections.aiAssistant',
        icon: 'aiAssistant',
        inWorkshops: true,
      },
      {
        href: 'chat',
        labelKey: 'organizer.eventHub.sections.chat',
        icon: 'chat',
        inWorkshops: true,
      },
    ],
  },
];

// --- menu profile (pure) ------------------------------------------------------

/**
 * Entries that change group in Workshops only, by href → the key of the group they join (at its
 * end). Schedule joins Programme, after Workshops, so the timetable sits next to what it times.
 */
export const WORKSHOPS_MOVES: ReadonlyMap<string, string> = new Map([['schedule', 'programme']]);

/**
 * The sidebar an organisation's profile shows. `everything` hands back the same arrays. `workshops`
 * keeps the entries marked `inWorkshops`, applies {@link WORKSHOPS_MOVES} and drops the groups left
 * empty. Only the menu changes: a hidden page still opens from a link.
 */
export function applyMenuProfile<O extends { readonly inWorkshops: boolean }>(
  groups: readonly EventNavGroup[],
  orgItems: readonly O[],
  profile: OrgMenuProfile,
): { groups: readonly EventNavGroup[]; orgItems: readonly O[] } {
  if (profile !== 'workshops') return { groups, orgItems };
  const kept = (item: EventNavItem) => shownIn(item, profile);
  const moved = groups.flatMap((g) =>
    g.items.filter((i) => kept(i) && WORKSHOPS_MOVES.has(i.href)),
  );
  const filtered = groups
    .map((g) => ({
      ...g,
      items: [
        ...g.items.filter((i) => kept(i) && !WORKSHOPS_MOVES.has(i.href)),
        ...moved.filter((i) => WORKSHOPS_MOVES.get(i.href) === g.key),
      ],
    }))
    .filter((g) => g.items.length > 0);
  return { groups: filtered, orgItems: orgItems.filter((i) => shownIn(i, profile)) };
}

/**
 * Does `profile` show this entry? The one rule, for the lists above and for an entry the shell
 * builds inline. Only an explicit `workshops` hides: a missing profile shows every entry.
 */
export function shownIn(
  item: { readonly inWorkshops: boolean },
  profile: OrgMenuProfile | undefined,
): boolean {
  return profile !== 'workshops' || item.inWorkshops;
}

// --- collapse state (pure helpers) ------------------------------------------

/** Map of group key → explicitly-collapsed (`false`) / explicitly-open (`true`). */
export type GroupOpenState = Record<string, boolean>;

/** Parse the persisted blob; tolerate null/garbage and keep only booleans. */
export function parseGroupState(raw: string | null): GroupOpenState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: GroupOpenState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeGroupState(state: GroupOpenState): string {
  return JSON.stringify(state);
}

/** Groups are open by default; only an explicit `false` collapses them. */
export function isGroupOpen(state: GroupOpenState, key: string): boolean {
  return state[key] !== false;
}

/** Returns a new state with `key` set to `open` (does not mutate the input). */
export function nextGroupState(state: GroupOpenState, key: string, open: boolean): GroupOpenState {
  return { ...state, [key]: open };
}

// --- localStorage-backed store (SSR-safe via useSyncExternalStore) ----------
//
// useSyncExternalStore is used instead of useState(localStorage)+useEffect so
// that (a) the server snapshot is a stable empty object (all groups open),
// avoiding a hydration mismatch, and (b) no setState-in-effect is introduced
// (keeps the shell's lint clean under the React Compiler rules).

const STORAGE_KEY = 'myclash.nav.eventGroups.v1';
const EMPTY_STATE: GroupOpenState = {};
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedState: GroupOpenState = EMPTY_STATE;

function getSnapshot(): GroupOpenState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  // Only swap the cached reference when the underlying blob changes, so the
  // snapshot stays referentially stable between renders.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parseGroupState(raw);
  }
  return cachedState;
}

function getServerSnapshot(): GroupOpenState {
  return EMPTY_STATE;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (typeof window !== 'undefined') window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', callback);
  };
}

function writeState(next: GroupOpenState): void {
  if (typeof window === 'undefined') return;
  const raw = serializeGroupState(next);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedState = next;
  for (const listener of listeners) listener();
}

export interface EventNavGroupsController {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** Read/persist which event nav groups are expanded. */
export function useEventNavGroups(): EventNavGroupsController {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    isOpen: (key: string) => isGroupOpen(state, key),
    toggle: (key: string) => {
      const current = getSnapshot();
      writeState(nextGroupState(current, key, !isGroupOpen(current, key)));
    },
  };
}
