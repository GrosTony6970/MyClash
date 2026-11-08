/**
 * An organisation's sidebar profile. `everything` shows every admin page; `workshops` hides the
 * tournament pages from the sidebar and the Event overview, for clubs that run only Workshops and
 * conferences. Hiding does not block: a hidden page still opens from a link.
 *
 * The one owner of the value list. Migration 0256's CHECK on `organizations.menu_profile` names
 * the same values; `packages/db/test/org-menu-profile.test.ts` pins that side.
 */

export const ORG_MENU_PROFILES = ['everything', 'workshops'] as const;
export type OrgMenuProfile = (typeof ORG_MENU_PROFILES)[number];

/**
 * The profile of a raw organisation read. A missing or unknown value reads as `everything`, so a
 * club never loses a page to a value this build does not know.
 */
export function asOrgMenuProfile(value: unknown): OrgMenuProfile {
  return value === 'workshops' ? 'workshops' : 'everything';
}
