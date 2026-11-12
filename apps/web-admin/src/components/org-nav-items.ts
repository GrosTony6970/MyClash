import type { EventNavItem } from './event-nav-groups';

/**
 * The organisation section of the organiser sidebar. Pure data, beside the event section in
 * ./event-nav-groups, so a node test can read it (the shell imports Next and React). Each entry
 * says whether it shows in Workshops only (`inWorkshops`, required).
 */
export interface OrgNavItem extends EventNavItem {
  /** Opts out of prefix matching in `pickActiveHref`. */
  readonly exact?: boolean;
}

export const ORG_NAV_ITEMS = [
  // `exact` so the org Overview (root) doesn't prefix-match and stay
  // highlighted on every `/org/{slug}/...` sub-route (incl. event pages).
  {
    href: '',
    labelKey: 'organizer.shell.nav.overview',
    icon: 'overview',
    exact: true,
    inWorkshops: true,
  },
  // `exact` prevents the events list from staying highlighted once
  // the operator drills into an event — sub-routes
  // `/org/{slug}/events/{eventId}/...` belong to the Event section.
  {
    href: 'events',
    labelKey: 'organizer.shell.nav.events',
    icon: 'events',
    exact: true,
    inWorkshops: true,
  },
  // Single "Rulesets" entry — the page redirects to /scoring and the
  // RulesetsTopNav pill at the top of each tab handles Scoring | Penalty
  // switching. pickActiveHref() uses startsWith() so the link stays
  // highlighted whether the operator is on /scoring or /penalty.
  {
    href: 'rulesets',
    labelKey: 'organizer.shell.nav.rulesets',
    icon: 'rulesets',
    inWorkshops: false,
  },
  // Org-level league management (approve requests, groups, ruleset, roles) for
  // leagues this org administers. `exact: false` so per-league sub-routes
  // (`/org/{slug}/leagues/{leagueId}`) keep the entry highlighted.
  { href: 'leagues', labelKey: 'organizer.shell.nav.leagues', icon: 'leagues', inWorkshops: false },
  // Org profile + members self-service (name/logo/contact, add/remove
  // members) — before this entry only super-admins could edit an org.
  // pickActiveHref longest-match keeps it distinct from settings/ai.
  // `members`, not a settings cog: the route is /settings but the entry the
  // operator reads is "Org Members" — the org profile + member list. The
  // "Org" prefix keeps it distinct from the event-scoped people under PEOPLE.
  {
    href: 'settings',
    labelKey: 'organizer.shell.nav.orgSettings',
    icon: 'members',
    inWorkshops: true,
  },
  {
    href: 'settings/ai',
    labelKey: 'organizer.shell.nav.aiSettings',
    icon: 'ai',
    inWorkshops: true,
  },
  // Compensation is unified under each event (Compensation plan + Referee
  // compensation tabs); no standalone org-settings entry.
  // Venues are org-level — operators manage the catalogue from this
  // entry. The event sidebar no longer surfaces venues; the
  // workshop + session venue pickers consume the org catalogue
  // directly.
  { href: 'venues', labelKey: 'organizer.shell.nav.venues', icon: 'venues', inWorkshops: true },
  // The safety reports fighters send about a spar; the page itself is for the club's admins.
  {
    href: 'fightbook-flags',
    labelKey: 'organizer.shell.nav.fightBookFlags',
    icon: 'safetyReports',
    inWorkshops: true,
  },
] as const satisfies readonly OrgNavItem[];
