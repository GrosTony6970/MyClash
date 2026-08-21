import { failureMessage, type ApiFailure } from '@myclash/api-client';
import type { PlatformRole } from '@myclash/types';

/**
 * The three populations the accounts console lists.
 *
 * PREDICATES, not a partition — matching the API. An account holding a
 * platform role AND an organisation membership satisfies `platform` and
 * `organizer` and appears under both tabs, which is the normal shape for a
 * HEMA organiser who also works the platform. Per-tab totals therefore overlap
 * and do not sum to the number of accounts; the pagination summary says so.
 */
export const USER_TABS = ['platform', 'organizer', 'user'] as const;
export type UsersTab = (typeof USER_TABS)[number];

export function isUsersTab(value: string | null): value is UsersTab {
  return (USER_TABS as readonly string[]).includes(value ?? '');
}

export interface UserOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface AdminUser {
  id: string;
  email?: string;
  display_name?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  organizations?: UserOrgMembership[];
  platform_role?: PlatformRole | null;
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  perPage: number;
  truncated?: boolean;
}

/** Names a tier for display. One vocabulary across table, form and detail page. */
export function roleLabelKey(role: PlatformRole | null | undefined): string {
  if (role === 'super_admin') return 'admin.users.role.superAdmin';
  if (role === 'platform_admin') return 'admin.users.role.platformAdmin';
  if (role === 'platform_viewer') return 'admin.users.role.platformViewer';
  return 'admin.users.role.none';
}

/** Disabled is a GoTrue ban, not a column of our own. */
export function isDisabled(user: AdminUser): boolean {
  return Boolean(user.banned_until);
}

export function getAccountLabel(user: AdminUser): string {
  return user.display_name?.trim() || user.email || user.id;
}

/** `{ persons: 1, organization_members: 2 }` → `"persons: 1, organization_members: 2"`. */
function formatBlockers(blockers: unknown): string | null {
  if (!blockers || typeof blockers !== 'object') return null;
  const entries = Object.entries(blockers as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length > 0 ? entries.join(', ') : null;
}

/**
 * The sentence for a refused account action, with the blockers appended.
 *
 * `failureMessage` already picks between the server's reason, the caller's
 * fallback and our own string for a throttle or a dead connection. What it
 * cannot do is name WHAT is blocking a delete: `blockers` rides in the API's
 * extension bag, because the API throws `BadRequestException({ message,
 * blockers })` and the exception filter moves every key except
 * `message`/`error`/`statusCode` into `details`. Reading `data.blockers` at the
 * top level finds nothing and degrades in silence, which is why safe delete
 * once said "this account still has references" without ever naming one.
 *
 * Returns `null` for an aborted request, exactly as `failureMessage` does —
 * there is nothing to tell the operator about their own navigation.
 *
 * Pass `blockersLabel` (already localized) to append them; `t` is a parameter
 * because module scope cannot run a hook.
 */
export function readError(
  failure: ApiFailure,
  t: (key: string) => string,
  fallback: string,
  blockersLabel?: string,
): string | null {
  const message = failureMessage(failure, t, fallback);
  if (message === null) return null;

  // The same narrowing `failureDetail` makes: only these two members carry a
  // bag, and `network` has none either.
  const details =
    failure.kind === 'http' || failure.kind === 'unauthenticated' ? failure.details : null;
  const blockerText = blockersLabel ? formatBlockers(details?.['blockers']) : null;
  if (!blockerText) return message;
  // The API's reason is a whole sentence and usually ends in a full stop, so
  // joining with ". " produced "still has references.. Blocked by". Only add
  // the stop when the sentence did not bring its own.
  const separator = /[.!?]$/.test(message) ? ' ' : '. ';
  return `${message}${separator}${blockersLabel}: ${blockerText}`;
}
