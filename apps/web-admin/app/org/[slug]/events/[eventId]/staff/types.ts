import { STAFF_ROLES, type StaffRole } from '@myclash/types';

export interface StaffAccount {
  id: string;
  display_name: string;
  username: string;
  status: 'active' | 'disabled';
  /** Which job this account does. See `@myclash/types/staff-role`. */
  role: StaffRole;
  liceIds: string[];
}

export interface Lice {
  id: string;
  name: string;
}

export interface EventInfo {
  id: string;
  slug: string;
  name: string;
}

/**
 * The tabs ARE the roles, one to one.
 *
 * Unlike the platform accounts console — whose tabs are predicates, so one
 * account can appear under two of them — `event_staff_accounts.role` is a
 * single NOT NULL column, so every account lands under exactly one tab and the
 * three counts sum to the total. That is why the create form can set the role
 * implicitly from the active tab: there is no case where the answer is
 * ambiguous.
 */
export function isStaffRoleTab(value: string | null): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value ?? '');
}

/**
 * Literal key maps, never a template literal.
 *
 * `t('organizer.staff.tabs.' + role)` would be invisible to
 * `t-key-references.test.ts` — it cannot see a key it has to compute — so a
 * missing French string would ship silently. Worse, handing the reverse sweep
 * the bare prefix `organizer.staff.` whitelists the whole subtree and blinds
 * the orphan check for every key on this page. Exact literals keep both gates
 * working. (StaffAccountCard.tsx carries the same note for the same reason.)
 */
export const STAFF_TAB_LABEL_KEYS: Record<StaffRole, string> = {
  scoring: 'organizer.staff.tabs.scoring',
  checkin: 'organizer.staff.tabs.checkin',
  gear: 'organizer.staff.tabs.gear',
};

export const STAFF_TAB_HINT_KEYS: Record<StaffRole, string> = {
  scoring: 'organizer.staff.tabHint.scoring',
  checkin: 'organizer.staff.tabHint.checkin',
  gear: 'organizer.staff.tabHint.gear',
};

export const STAFF_TAB_EMPTY_KEYS: Record<StaffRole, string> = {
  scoring: 'organizer.staff.emptyScoring',
  checkin: 'organizer.staff.emptyCheckin',
  gear: 'organizer.staff.emptyGear',
};

export const STAFF_TAB_CREATE_KEYS: Record<StaffRole, string> = {
  scoring: 'organizer.staff.createScoring',
  checkin: 'organizer.staff.createCheckin',
  gear: 'organizer.staff.createGear',
};
