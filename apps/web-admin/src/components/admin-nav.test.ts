import { describe, expect, it } from 'vitest';
import { visibleNavSections } from './admin-nav';

/**
 * Which console entries each platform tier sees. The API refuses a reserved page's read anyway
 * (platform-role-coverage.test.ts pins those tiers); this pins the menu, so an entry that a lower
 * tier would only reach as a 403 dead end, or a reserved one shown to all, fails here.
 */

/** Pages whose read only a super admin may make: hidden from the two lower tiers. */
const RESERVED = [
  '/admin/photos',
  '/admin/fightbook-flags',
  '/admin/backups',
  '/admin/ai/keys',
  '/admin/ai/budget',
  '/admin/feature-flags',
  '/admin/data-retention',
];

const EVERY_ENTRY = [
  '/admin',
  '/admin/organizations',
  '/admin/users',
  '/admin/fighters',
  '/admin/clubs',
  '/admin/leagues',
  '/admin/rulesets',
  '/admin/weapons',
  '/admin/review-queue',
  '/admin/exchange-edit-requests',
  '/admin/global-persons/pending-claims',
  '/admin/photos',
  '/admin/fightbook-flags',
  '/admin/hema-ratings',
  '/admin/system-versions',
  '/admin/backups',
  '/admin/audit-log',
  '/admin/ai',
  '/admin/ai/keys',
  '/admin/ai/models',
  '/admin/ai/budget',
  '/admin/data-quality',
  '/admin/feature-flags',
  '/admin/data-retention',
];

const hrefs = (role: Parameters<typeof visibleNavSections>[0]) =>
  visibleNavSections(role).flatMap((section) => section.items.map((item) => item.href));
const headings = (role: Parameters<typeof visibleNavSections>[0]) =>
  visibleNavSections(role).map((section) => section.headingKey);

describe('the console menu, per platform tier', () => {
  it('shows a super admin every entry, in order', () => {
    expect(hrefs('super_admin')).toEqual(EVERY_ENTRY);
  });

  it.each(['platform_admin', 'platform_viewer'] as const)(
    'shows a %s every entry but the reserved ones',
    (role) => {
      expect(hrefs(role)).toEqual(EVERY_ENTRY.filter((href) => !RESERVED.includes(href)));
    },
  );

  it('drops a section left empty: Settings holds only reserved entries', () => {
    expect(headings('super_admin')).toContain('admin.shell.sectionSettings');
    expect(headings('platform_admin')).not.toContain('admin.shell.sectionSettings');
    expect(headings('platform_viewer')).not.toContain('admin.shell.sectionSettings');
  });

  it('shows nothing to a login with no platform tier', () => {
    expect(visibleNavSections(null)).toEqual([]);
  });
});
