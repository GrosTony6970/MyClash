import { atLeastPlatformRole, type PlatformRole } from '@myclash/types';
import type { NavIconName } from '@myclash/ui';

interface NavItem {
  href: string;
  labelKey: string;
  icon: NavIconName;
  /**
   * Lowest tier that may see this entry. Defaults to `platform_viewer` —
   * every console page has a readable GET, so hiding one is the exception.
   *
   * Set it only where the PAGE itself is reserved (the API refuses even the
   * read). This mirrors the route tiers in platform-role-coverage.test.ts; a
   * nav entry left visible for a page whose GET 403s is a dead end, not a
   * leak. admin-nav.test.ts lists the reserved entries.
   */
  minRole?: PlatformRole;
}

export interface NavSection {
  /** i18n key for the section header. */
  headingKey: string;
  items: readonly NavItem[];
}

/**
 * Sidebar IA — items grouped into six sections so the entries don't read
 * as one flat wall.
 *
 *   1. Overview        — single dashboard entry.
 *   2. Content         — orgs, users, profiles, clubs, leagues, rulesets.
 *   3. Operations      — review queue, frozen results, profile claims, ratings.
 *   4. Platform health — system, backups, audit log.
 *   5. AI              — dashboard, keys, model catalog, budget, data quality.
 *   6. Settings        — feature flags.
 *
 * `isActive()` exact-matches /admin and /admin/ai so those landing entries
 * don't stay lit alongside their sibling children.
 */
const navSections: readonly NavSection[] = [
  {
    headingKey: 'admin.shell.sectionOverview',
    items: [{ href: '/admin', labelKey: 'admin.shell.nav.overview', icon: 'overview' }],
  },
  {
    headingKey: 'admin.shell.sectionContent',
    items: [
      {
        href: '/admin/organizations',
        labelKey: 'admin.shell.nav.organizations',
        icon: 'organizations',
      },
      { href: '/admin/users', labelKey: 'admin.shell.nav.users', icon: 'accounts' },
      {
        href: '/admin/fighters',
        labelKey: 'admin.shell.nav.globalProfiles',
        icon: 'globalProfiles',
      },
      { href: '/admin/clubs', labelKey: 'admin.shell.nav.clubs', icon: 'clubs' },
      { href: '/admin/leagues', labelKey: 'admin.shell.nav.leagues', icon: 'leagues' },
      // Single side-menu entry; the page redirects to /scoring and the
      // RulesetsTopNav pills handle the Scoring | Penalty tab switch.
      // The isActive() check uses startsWith('/admin/rulesets') so the
      // link stays highlighted on both sub-routes.
      { href: '/admin/rulesets', labelKey: 'admin.shell.nav.rulesets', icon: 'rulesets' },
      { href: '/admin/weapons', labelKey: 'admin.shell.nav.weapons', icon: 'weapons' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionOperations',
    items: [
      {
        href: '/admin/review-queue',
        labelKey: 'admin.reviewQueue.navTitle',
        icon: 'reviewQueue',
      },
      {
        href: '/admin/exchange-edit-requests',
        labelKey: 'admin.shell.nav.frozenResults',
        icon: 'frozenResults',
      },
      // Global-person claim queue (the /me "§8 fallback" when a profile has
      // no email) — without this entry the queue was reachable only by URL
      // and claims sat unreviewed.
      {
        href: '/admin/global-persons/pending-claims',
        labelKey: 'admin.shell.nav.pendingClaims',
        icon: 'pendingClaims',
      },
      // Every Event's photos, to answer a removal request (rulings 491-493).
      {
        href: '/admin/photos',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.photos',
        icon: 'photos',
      },
      // Ratings sits with Operations, not Platform health: syncing HEMA
      // Ratings is a recurring operator chore, not a signal about whether
      // the platform itself is healthy.
      { href: '/admin/hema-ratings', labelKey: 'admin.shell.nav.hemaRatings', icon: 'ratings' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionPlatformHealth',
    items: [
      {
        href: '/admin/system-versions',
        labelKey: 'admin.shell.nav.systemVersions',
        icon: 'system',
      },
      {
        href: '/admin/backups',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.backups',
        icon: 'backups',
      },
      { href: '/admin/audit-log', labelKey: 'admin.shell.nav.auditLog', icon: 'auditLog' },
    ],
  },
  {
    // Data Quality lives here (not Platform health): its scans are LLM-ranked
    // and its findings deep-link from the AI notification bell. Its route
    // stays /admin/data-quality — only the sidebar grouping moved.
    headingKey: 'admin.shell.sectionAI',
    items: [
      { href: '/admin/ai', labelKey: 'admin.shell.nav.aiDashboard', icon: 'ai' },
      {
        href: '/admin/ai/keys',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.aiKeys',
        icon: 'aiKeys',
      },
      // Model catalog directly under the keys it is configured with.
      { href: '/admin/ai/models', labelKey: 'admin.shell.nav.aiModels', icon: 'aiModels' },
      {
        href: '/admin/ai/budget',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.aiBudget',
        icon: 'aiBudget',
      },
      { href: '/admin/data-quality', labelKey: 'admin.shell.nav.dataQuality', icon: 'dataQuality' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionSettings',
    items: [
      {
        href: '/admin/feature-flags',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.featureFlags',
        icon: 'featureFlags',
      },
      {
        href: '/admin/data-retention',
        minRole: 'super_admin' as const,
        labelKey: 'admin.shell.nav.dataRetention',
        icon: 'dataRetention',
      },
    ],
  },
];

/**
 * Sections with their entries filtered to the caller's tier, and any section
 * left with NOTHING dropped entirely.
 *
 * Dropping empty sections is the load-bearing half: `Settings` holds only
 * super-admin entries, so for the two lower tiers it would otherwise render
 * as a bare heading above a gap. Which entries each tier sees is pinned in
 * admin-nav.test.ts.
 */
export function visibleNavSections(platformRole: PlatformRole | null): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        atLeastPlatformRole(platformRole, item.minRole ?? 'platform_viewer'),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
