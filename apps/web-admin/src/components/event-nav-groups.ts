import { useSyncExternalStore } from 'react';

/**
 * Thematic grouping of the event-scoped admin sidebar. The flat list of
 * event sections is split into four collapsible themed groups; "Event
 * overview" stays ungrouped at the top (rendered directly under the event
 * switcher in {@link OrganizerAdminShell}).
 *
 * The taxonomy lives here (not inline in the shell) so it can be unit-tested
 * — see event-nav-groups.test.ts, which guards against dropping/duplicating a
 * route and asserts every heading key resolves in both locales.
 */
export interface EventNavItem {
  readonly href: string;
  readonly labelKey: string;
  readonly badge: string;
}

export interface EventNavGroup {
  readonly key: string;
  readonly headingKey: string;
  readonly items: readonly EventNavItem[];
}

export const EVENT_NAV_OVERVIEW: EventNavItem = {
  href: '',
  labelKey: 'organizer.shell.nav.eventOverview',
  badge: 'E',
};

export const EVENT_NAV_GROUPS: readonly EventNavGroup[] = [
  {
    key: 'people',
    headingKey: 'organizer.shell.eventGroups.people',
    items: [
      { href: 'persons', labelKey: 'organizer.eventHub.sections.persons', badge: 'P' },
      { href: 'clubs', labelKey: 'organizer.shell.nav.clubs', badge: 'CL' },
      { href: 'referees', labelKey: 'organizer.eventHub.sections.referees', badge: 'J' },
      { href: 'staff', labelKey: 'organizer.eventHub.sections.staff', badge: 'ST' },
    ],
  },
  {
    key: 'competition',
    headingKey: 'organizer.shell.eventGroups.competition',
    items: [
      { href: 'tournaments', labelKey: 'organizer.shell.nav.tournaments', badge: 'TR' },
      // Badge PL (not P) to disambiguate from Participants in the People group.
      { href: 'pools', labelKey: 'organizer.eventHub.sections.pools', badge: 'PL' },
      { href: 'bracket', labelKey: 'organizer.eventHub.sections.bracket', badge: 'B' },
      {
        href: 'finalranking',
        labelKey: 'organizer.eventHub.sections.finalRanking',
        badge: 'FR',
      },
      { href: 'schedule', labelKey: 'organizer.eventHub.sections.schedule', badge: 'S' },
      { href: 'leagues', labelKey: 'admin.dashboard.leaguesTitle', badge: 'L' },
    ],
  },
  {
    key: 'programme',
    headingKey: 'organizer.shell.eventGroups.programme',
    items: [{ href: 'workshops', labelKey: 'organizer.eventHub.sections.workshops', badge: 'W' }],
  },
  {
    key: 'admin',
    headingKey: 'organizer.shell.eventGroups.admin',
    items: [
      { href: 'compensation', labelKey: 'organizer.eventHub.sections.compensation', badge: 'C' },
      { href: 'notifications', labelKey: 'organizer.eventHub.sections.notifications', badge: 'N' },
      { href: 'theme', labelKey: 'organizer.eventHub.sections.theme', badge: 'T' },
      { href: 'archive', labelKey: 'organizer.archive.navLabel', badge: 'A' },
      { href: 'ai-assistant', labelKey: 'organizer.eventHub.sections.aiAssistant', badge: 'AI' },
      { href: 'chat', labelKey: 'organizer.eventHub.sections.chat', badge: 'CH' },
    ],
  },
];

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
