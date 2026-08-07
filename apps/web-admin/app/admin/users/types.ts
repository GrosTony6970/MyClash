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
 * Read the API's RFC 9457 problem body.
 *
 * `blockers` sits under `details`, NOT at the top level: the API throws
 * `BadRequestException({ message, blockers })`, and ApiExceptionFilter moves
 * every key except `message`/`error`/`statusCode` into `details`. Reading
 * `data.blockers` finds nothing and degrades silently to a bare message — which
 * is why safe delete only ever said "this account still has references" without
 * ever naming one.
 *
 * Pass `blockersLabel` (a localized string) to append them; `t` is not
 * reachable from module scope.
 */
export async function readError(
  res: Response,
  fallback: string,
  blockersLabel?: string,
): Promise<string> {
  if (res.status === 429) return fallback;
  try {
    const data = (await res.json()) as { message?: unknown; details?: { blockers?: unknown } };
    if (typeof data.message !== 'string') return fallback;

    const blockerText = blockersLabel ? formatBlockers(data.details?.blockers) : null;
    return blockerText ? `${data.message}. ${blockersLabel}: ${blockerText}` : data.message;
  } catch {
    // Keep the UI on the generic localized error when the API body is empty.
  }
  return fallback;
}
