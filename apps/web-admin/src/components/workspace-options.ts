import { parsePlatformRole, type PlatformRole } from '@myclash/types';

/**
 * Pure derivation of the workspaces an account can reach, for the sidebar
 * workspace label + switcher.
 *
 * Extracted from the shells for the same reason as `resolveAuthDecision`: both
 * SuperAdminShell and OrganizerAdminShell need the identical list, and the
 * interesting cases (dual-role operator, multi-org operator, platform staff
 * inside an org they don't belong to) are all reachable without mounting React.
 *
 * It replaces three hand-rolled cross-workspace links that each picked their
 * own target. The platform console in particular used
 * `organizations.find(o => o.slug)` — an arbitrary org, since the membership
 * query carries no ORDER BY — so an operator in two clubs could reach exactly
 * one of them and had no way to tell which.
 */

export type WorkspaceMePayload = {
  admin?: {
    /** Any truthy tier grants the platform workspace; null is an ordinary user. */
    platformRole?: string | null;
    organizations?: Array<{ slug?: string | null; name?: string | null }>;
  } | null;
};

export type WorkspaceOption =
  | {
      kind: 'platform';
      href: string;
      /**
       * Parsed tier, shown as a secondary line on the platform row. Null when
       * the payload carries a tier this build doesn't know — the row still
       * renders (the shells gate entry on raw truthiness, so hiding it here
       * would strand the user), it just falls back to the read-only label.
       */
      tier: PlatformRole | null;
    }
  | { kind: 'org'; href: string; slug: string; name: string };

export type CurrentWorkspace = { kind: 'platform' } | { kind: 'org'; slug: string };

export type WorkspaceOptions = {
  options: WorkspaceOption[];
  /** The entry matching `current`, or null when it isn't one of the options. */
  current: WorkspaceOption | null;
};

const EMPTY: WorkspaceOptions = { options: [], current: null };

export function resolveWorkspaceOptions(
  me: WorkspaceMePayload | null,
  current: CurrentWorkspace,
): WorkspaceOptions {
  // `/me` not resolved yet. Returning nothing (rather than a one-item list) is
  // what keeps the shell on its static label instead of flashing a switch icon
  // and a half-built menu on every load.
  if (!me?.admin) return EMPTY;

  const options: WorkspaceOption[] = [];

  if (me.admin.platformRole) {
    options.push({
      kind: 'platform',
      href: '/admin',
      tier: parsePlatformRole(me.admin.platformRole),
    });
  }

  const orgs = (me.admin.organizations ?? [])
    .map((org) => {
      const slug = org.slug?.trim();
      if (!slug) return null;
      // Slug fallback so a row is never blank. The API drops nameless rows, so
      // this only fires against an older API build.
      const name = org.name?.trim() || slug;
      return { kind: 'org' as const, href: `/org/${slug}`, slug, name };
    })
    .filter((org): org is Extract<WorkspaceOption, { kind: 'org' }> => org !== null)
    // Sorted by name, never by membership-row order: the query has no ORDER BY,
    // so "first org" is whatever Postgres felt like returning that request.
    .sort((a, b) => a.name.localeCompare(b.name));

  options.push(...orgs);

  return { options, current: findCurrent(options, current) };
}

function findCurrent(options: WorkspaceOption[], current: CurrentWorkspace) {
  const match = options.find((option) =>
    current.kind === 'platform'
      ? option.kind === 'platform'
      : option.kind === 'org' && option.slug === current.slug,
  );
  // Reachable and not an error: platform staff may open ANY org slug
  // (organizer-auth-decision allows it) without holding a membership, so the
  // org they are looking at is genuinely not one of their own workspaces.
  return match ?? null;
}
