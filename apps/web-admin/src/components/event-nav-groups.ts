import { roleAtLeast, type OrgMenuProfile, type OrgRole } from '@myclash/types';
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
  /**
   * The club role its page needs to load (ruling 893): the menu hides the entry from a member below
   * it, rather than open a page that refuses them. Read off the API's check on the page's main
   * read. Required, for the same reason as `inWorkshops`.
   */
  readonly minRole: OrgRole;
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
  minRole: 'scorekeeper',
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
        minRole: 'read_only',
      },
      {
        href: 'clubs',
        labelKey: 'organizer.shell.nav.clubs',
        icon: 'clubs',
        inWorkshops: true,
        minRole: 'scorekeeper',
      },
      {
        href: 'referees',
        labelKey: 'organizer.eventHub.sections.referees',
        icon: 'referees',
        inWorkshops: false,
        minRole: 'read_only',
      },
      {
        href: 'staff',
        labelKey: 'organizer.eventHub.sections.staff',
        icon: 'staff',
        inWorkshops: true,
        minRole: 'editor',
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
        minRole: 'scorekeeper',
      },
      {
        href: 'live',
        labelKey: 'organizer.eventHub.sections.live',
        icon: 'live',
        inWorkshops: false,
        minRole: 'scorekeeper',
      },
      {
        href: 'tournaments',
        labelKey: 'organizer.shell.nav.tournaments',
        icon: 'tournaments',
        inWorkshops: false,
        minRole: 'read_only',
      },
      {
        href: 'pools',
        labelKey: 'organizer.eventHub.sections.pools',
        icon: 'pools',
        inWorkshops: false,
        minRole: 'read_only',
      },
      // Between Pools and Bracket because that is where the phase runs:
      // pools -> Swiss -> bracket is a valid three-stage tournament.
      {
        href: 'swiss',
        labelKey: 'organizer.eventHub.sections.swiss',
        icon: 'swiss',
        inWorkshops: false,
        minRole: 'read_only',
      },
      {
        href: 'bracket',
        labelKey: 'organizer.eventHub.sections.bracket',
        icon: 'bracket',
        inWorkshops: false,
        minRole: 'read_only',
      },
      {
        href: 'finalranking',
        labelKey: 'organizer.eventHub.sections.finalRanking',
        icon: 'finalRanking',
        inWorkshops: false,
        minRole: 'read_only',
      },
      // Sits with the results rather than with the exports on the archive page:
      // organisers reach for it straight after the final ranking is settled.
      {
        href: 'hema-ratings',
        labelKey: 'organizer.eventHub.sections.hemaRatings',
        icon: 'ratings',
        inWorkshops: false,
        minRole: 'admin',
      },
      // Second-black-card disqualification review queue (write-only state
      // machine before this page existed — the DQ rule never enforced).
      {
        href: 'penalties',
        labelKey: 'organizer.eventHub.sections.penalties',
        icon: 'penalties',
        inWorkshops: false,
        minRole: 'read_only',
      },
      // Kept in Workshops only, where it moves to Programme (WORKSHOPS_MOVES).
      {
        href: 'schedule',
        labelKey: 'organizer.eventHub.sections.schedule',
        icon: 'schedule',
        inWorkshops: true,
        minRole: 'read_only',
      },
      {
        href: 'statistics',
        labelKey: 'organizer.eventHub.sections.statistics',
        icon: 'statistics',
        inWorkshops: false,
        minRole: 'scorekeeper',
      },
      // Beside the results it qualifies: the report says whether the timings
      // attached to them can be trusted.
      {
        href: 'clock',
        labelKey: 'organizer.clockReport.navLabel',
        icon: 'clockReport',
        inWorkshops: false,
        minRole: 'scorekeeper',
      },
      // Reads the same day from the other end: the clock report qualifies the
      // results, this one says what never arrived to be qualified.
      {
        href: 'debrief',
        labelKey: 'organizer.debrief.navLabel',
        icon: 'auditLog',
        inWorkshops: false,
        minRole: 'scorekeeper',
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
        minRole: 'read_only',
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
        minRole: 'admin',
      },
      {
        href: 'notifications',
        labelKey: 'organizer.eventHub.sections.notifications',
        icon: 'notifications',
        inWorkshops: true,
        minRole: 'admin',
      },
      {
        href: 'photos',
        labelKey: 'organizer.eventHub.sections.photos',
        icon: 'photos',
        inWorkshops: true,
        minRole: 'admin',
      },
      {
        href: 'theme',
        labelKey: 'organizer.eventHub.sections.theme',
        icon: 'theme',
        inWorkshops: true,
        minRole: 'read_only',
      },
      {
        href: 'archive',
        labelKey: 'organizer.archive.navLabel',
        icon: 'archive',
        inWorkshops: true,
        minRole: 'admin',
      },
      {
        href: 'ai-assistant',
        labelKey: 'organizer.eventHub.sections.aiAssistant',
        icon: 'aiAssistant',
        inWorkshops: true,
        minRole: 'admin',
      },
      {
        href: 'chat',
        labelKey: 'organizer.eventHub.sections.chat',
        icon: 'chat',
        inWorkshops: true,
        minRole: 'admin',
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
 * The sidebar a member's club role opens (ruling 893): an entry below their role goes, and a group
 * left empty with it. Léa, an Editor, no longer sees Photos and Notifications, whose pages refuse
 * her. `role` null is a reader with no membership in this club — platform staff, let in by their
 * platform role — whose reach is decided route by route, so they keep the whole menu. Only the menu
 * changes: a hidden page still answers a link, with the refusal it always gave.
 */
export function applyMemberRole<O extends { readonly minRole: OrgRole }>(
  groups: readonly EventNavGroup[],
  orgItems: readonly O[],
  role: string | null,
): { groups: readonly EventNavGroup[]; orgItems: readonly O[] } {
  if (role === null) return { groups, orgItems };
  const opens = (item: { readonly minRole: OrgRole }) => roleAtLeast(role, item.minRole);
  return {
    groups: groups
      .map((g) => ({ ...g, items: g.items.filter(opens) }))
      .filter((g) => g.items.length > 0),
    orgItems: orgItems.filter(opens),
  };
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

export * from './event-nav-collapse';
