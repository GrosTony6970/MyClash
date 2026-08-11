import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePlatformUserDto,
  ORG_ROLES,
  UpdatePlatformUserDto,
  type OrgRole,
  type UserListScope,
} from './dto/admin-users.dto';
import { SupabaseService, type SupabaseAdminUser } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { insertAuditLog } from '../../common/audit-log';
import { generateTemporaryPassword } from '../../common/temp-password';
import { hasPlatformTier } from '../../common/auth/platform-role';
import { parsePlatformRole, type PlatformRole } from '@myclash/types';

export interface ListUsersQuery {
  page?: number;
  perPage?: number;
  q?: string;
  /** See USER_LIST_SCOPES — predicates, not a partition. */
  scope?: UserListScope;
}

export type DeletePlatformUserMode = 'safe' | 'cleanup';

interface UserDeletionBlockers {
  references: Record<string, number>;
  soleOwnerOrganizationIds: string[];
}

/**
 * How a table's rows are reached from the account being deleted.
 *
 * These are NOT interchangeable, and conflating them is the whole reason this
 * type exists. Both of the bugs it was introduced to fix were a column whose
 * NAME implied one reach while it held another:
 *
 *  - `uid`           column holds an auth.users id.
 *  - `person`        column holds a persons.id (the EVENT-SCOPED roster row).
 *  - `global_person` column holds a global_persons.id (cross-event identity).
 *
 * The trap: `workshop_enrollments.user_id` is named like a uid but holds a
 * persons.id — guests carry a persons.id with no account at all. Comparing it
 * to a uid matches nothing, silently, so enrollments never blocked a delete and
 * were never cleaned. Same vocabulary as `SubjectReach` in
 * ../privacy/subject-export.tables.ts, which learned this on the same tables.
 */
export type ReferenceReach = 'uid' | 'person' | 'global_person';

export interface ReferenceCheck {
  /** Key in the `blockers.references` response. Stable; the UI prints it. */
  key: string;
  table: string;
  column: string;
  reach: ReferenceReach;
  /**
   * Cleanup DELETES these rows. Only ever true for `reach: 'uid'` — see the
   * invariant on CLEANUP_DELETIONS below. Pinned by admin-users.schema.test.ts.
   */
  cleanup: boolean;
}

/**
 * Every way MyClash still points at a platform account, and how to reach it.
 *
 * ONE list with TWO consumers (the safe-delete blocker count and the cleanup
 * delete), because the two hand-maintained lists this replaces had drifted from
 * the schema AND from each other. Neither drift was visible: `.from(table)` with
 * a variable is invisible to common/db-schema-conformance.test.ts, whose scanner
 * only matches literal table names, and the service tests mock Supabase, which
 * returns rows for a dropped column exactly as happily as for a live one.
 *
 * Migration 0063 dropped `referee_qualifications.user_id` (referee tables are
 * keyed on person_id now, reaching a login only through
 * global_persons.claimed_by_user_id). The stale entry made PostgREST 400 the
 * whole query — so EVERY platform account delete failed, in both modes, for
 * every account, including brand-new ones with nothing attached: an unknown
 * column fails at plan time, before any row is examined.
 *
 * MAINTENANCE: admin-users.schema.test.ts replays all migrations and fails if
 * any (table, column) below stops existing. Add entries there, not from memory.
 */
const REFERENCE_CHECKS: readonly ReferenceCheck[] = [
  // ── Owned outright by the login: access, devices, comms, outbound social ────
  {
    key: 'platform_roles',
    table: 'platform_roles',
    column: 'user_id',
    reach: 'uid',
    cleanup: true,
  },
  {
    key: 'organization_members',
    table: 'organization_members',
    column: 'user_id',
    reach: 'uid',
    cleanup: true,
  },
  {
    key: 'push_subscriptions',
    table: 'push_subscriptions',
    column: 'user_id',
    reach: 'uid',
    cleanup: true,
  },
  {
    key: 'notification_preferences',
    table: 'notification_preferences',
    column: 'user_id',
    reach: 'uid',
    cleanup: true,
  },
  { key: 'follows', table: 'follows', column: 'follower_user_id', reach: 'uid', cleanup: true },
  {
    key: 'event_broadcast_recipients',
    table: 'event_broadcast_recipients',
    column: 'user_id',
    reach: 'uid',
    cleanup: true,
  },

  // ── Identity rows: cleanup UNLINKS these (claim nulled), never deletes ──────
  // Deleting them would erase the competitor along with the login.
  {
    key: 'persons',
    table: 'persons',
    column: 'claimed_by_user_id',
    reach: 'uid',
    cleanup: false,
  },
  {
    key: 'global_persons',
    table: 'global_persons',
    column: 'claimed_by_user_id',
    reach: 'uid',
    cleanup: false,
  },

  // ── Historical event facts: counted, reported, NEVER deleted ────────────────
  // The button promises "keeping historical facts" / "Historical event facts
  // remain" (admin.users.actions.cleanupDeleteHelp). A workshop attendance and a
  // referee qualification are event records, not private links — ErasureService,
  // the owner of "what deleting a user means", excludes both from its OWNED
  // delete list for the same reason. Removing the claim above already unlinks
  // them from the person.
  //
  // Neither entry can be the SOLE blocker: workshop_enrollments is reached
  // through persons and referee_qualifications through global_persons, so the
  // identity blocker above always fires alongside. They exist to tell the admin
  // WHAT is there.
  {
    key: 'workshop_enrollments',
    table: 'workshop_enrollments',
    // NOT a uid. See the trap in the ReferenceReach docblock.
    column: 'user_id',
    reach: 'person',
    cleanup: false,
  },
  {
    key: 'referee_qualifications',
    table: 'referee_qualifications',
    // 0063 dropped user_id; person_id holds a global_persons.id.
    column: 'person_id',
    reach: 'global_person',
    cleanup: false,
  },
];

/** Derived, so the delete set can never drift from the checked set again. */
const CLEANUP_DELETIONS: readonly ReferenceCheck[] = REFERENCE_CHECKS.filter(
  (check) => check.cleanup,
);

export const DELETION_REFERENCE_CHECKS = REFERENCE_CHECKS;

/** PostgREST puts `.in()` values in the URL; keep each request well under any limit. */
const IN_CHUNK = 200;

function* chunked(values: readonly string[]): Generator<readonly string[]> {
  for (let i = 0; i < values.length; i += IN_CHUNK) yield values.slice(i, i + IN_CHUNK);
}

export interface UserOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

export interface ListPlatformUsersResult {
  users: ListedPlatformUser[];
  /**
   * Matches for THIS scope before paging. The three scopes are predicates, not
   * a partition, so their totals overlap and do not sum to the account count.
   */
  total: number;
  page: number;
  perPage: number;
  /** Set when the GoTrue enumeration hit its ceiling and the page is partial. */
  truncated?: boolean;
}

type ListedPlatformUser = SupabaseAdminUser & {
  display_name: string | null;
  organizations: UserOrgMembership[];
  platform_role: PlatformRole | null;
};

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * List accounts in one scope, paged and searched SERVER-side.
   *
   * ## Why this cannot be one query
   *
   * There is no `auth.users` mirror in the `public` schema, so PostgREST cannot
   * see the account table at all. Nothing can join an account to
   * `platform_roles` or `organization_members` in the database; every scope
   * filter is an in-app merge over data fetched from two different places.
   *
   * GoTrue's own `?filter=` is not usable either: it matches `email` or
   * `raw_user_meta_data->>'full_name'`, and this app writes `display_name`.
   * Searching through it would silently miss every admin-set name.
   *
   * ## Consequences, stated rather than discovered later
   *
   * `scope=platform` never enumerates: the ids come straight from
   * `platform_roles`, which holds tens of rows. The other two scopes must
   * enumerate, and stop at ten pages of a thousand — about ten thousand
   * accounts. That ceiling used to truncate in SILENCE; it now sets
   * `truncated` on the response. The real fix is a `public.user_directory`
   * mirror fed from GoTrue, which collapses all of this into one indexed query
   * with `ilike` and an exact count. Out of scope here.
   */
  async listUsers(query: ListUsersQuery = {}): Promise<ListPlatformUsersResult> {
    const page = Math.max(query.page ?? 1, 1);
    const perPage = Math.min(Math.max(query.perPage ?? 50, 1), 100);
    const raw = query.q?.trim();
    const search = raw ? normalizeSearch(raw) : null;
    const scope: UserListScope = query.scope ?? 'platform';

    const platformRoleByUser = await this.fetchPlatformRoles();

    const { matched, truncated } =
      scope === 'platform'
        ? await this.collectPlatformScope(platformRoleByUser, search)
        : await this.collectEnumeratedScope(scope, platformRoleByUser, search);

    matched.sort((a, b) => this.compareListed(a, b, search));

    const start = (page - 1) * perPage;
    const slice = matched.slice(start, start + perPage);
    // Org detail is fetched for the PAGE only — the scope predicate above runs
    // on an id set, so a big listing never fans out into per-row org queries.
    const orgsByUser = await this.fetchOrgMembershipsByUser(slice.map((u) => u.id));

    return {
      users: slice.map((u) => ({ ...u, organizations: orgsByUser.get(u.id) ?? [] })),
      total: matched.length,
      page,
      perPage,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  /**
   * `scope=platform` — every account holding a platform_roles row.
   *
   * Hydrated one id at a time rather than by enumerating GoTrue: the table has
   * tens of rows, and enumerating ten thousand accounts to find twelve of them
   * would be the most wasteful thing this service does.
   */
  private async collectPlatformScope(
    platformRoleByUser: Map<string, PlatformRole>,
    search: string | null,
  ): Promise<{ matched: ListedPlatformUser[]; truncated: boolean }> {
    const matched: ListedPlatformUser[] = [];
    for (const [userId, role] of platformRoleByUser) {
      const response = await this.supabase.getAuthAdminUser(userId);
      if (!response.ok || !response.data?.id) {
        // A platform_roles row whose account is gone. Not fatal: the row is
        // orphaned data, and refusing the whole listing over it would break the
        // console exactly when someone needs it to clean that up.
        this.logger.warn(`platform_roles references a missing auth user ${userId}`);
        continue;
      }
      const listed = this.toListedUser(response.data, undefined, role);
      if (search && !this.userMatchesSearch(listed, search)) continue;
      matched.push(listed);
    }
    return { matched, truncated: false };
  }

  /** `scope=organizer` / `scope=user` — the enumerating path. */
  private async collectEnumeratedScope(
    scope: Exclude<UserListScope, 'platform'>,
    platformRoleByUser: Map<string, PlatformRole>,
    search: string | null,
  ): Promise<{ matched: ListedPlatformUser[]; truncated: boolean }> {
    const orgMemberIds = await this.fetchAllOrgMemberUserIds();
    const matched: ListedPlatformUser[] = [];
    const authPageSize = 1000;
    const maxPages = 10;
    let truncated = false;
    let currentPage = 1;

    while (currentPage <= maxPages) {
      const response = await this.supabase.listAuthAdminUsers(currentPage, authPageSize);
      if (!response.ok || !response.data) {
        this.logger.warn(`Could not list Auth users through GoTrue: ${response.status}`);
        throw new BadRequestException('Could not inspect platform accounts');
      }

      for (const user of response.data.users) {
        const isOrganizer = orgMemberIds.has(user.id);
        const holdsPlatformRole = platformRoleByUser.has(user.id);
        // Predicates, not a partition: an account can be both an organiser and
        // platform staff, and shows on both tabs. Only `user` is defined by
        // absence — it is the tab for everyone else.
        const inScope = scope === 'organizer' ? isOrganizer : !isOrganizer && !holdsPlatformRole;
        if (!inScope) continue;

        const listed = this.toListedUser(user, undefined, platformRoleByUser.get(user.id) ?? null);
        if (search && !this.userMatchesSearch(listed, search)) continue;
        matched.push(listed);
      }

      if (response.data.users.length < authPageSize) break;
      currentPage += 1;
      if (currentPage > maxPages) {
        this.logger.warn(
          `Auth enumeration hit its ${maxPages}-page ceiling; the accounts listing is incomplete.`,
        );
        truncated = true;
      }
    }

    return { matched, truncated };
  }

  /** Best match first when searching, then stable by email. */
  private compareListed(
    a: ListedPlatformUser,
    b: ListedPlatformUser,
    search: string | null,
  ): number {
    if (search) {
      const diff = this.userSearchScore(b, search) - this.userSearchScore(a, search);
      if (diff !== 0) return diff;
    }
    return (a.email ?? a.id).localeCompare(b.email ?? b.id);
  }

  /** Every platform role, by user id. One query; the table holds tens of rows. */
  private async fetchPlatformRoles(): Promise<Map<string, PlatformRole>> {
    const { data, error } = await this.supabase.service
      .from('platform_roles')
      .select('user_id, role');
    if (error) {
      this.logger.warn(`Could not fetch platform roles: ${error.message}`);
      return new Map();
    }
    const map = new Map<string, PlatformRole>();
    for (const row of (data ?? []) as Array<{ user_id?: string; role?: string }>) {
      const role = parsePlatformRole(row.role);
      if (row.user_id && role) map.set(row.user_id, role);
    }
    return map;
  }

  async getUser(userId: string) {
    const response = await this.supabase.getAuthAdminUser(userId);
    if (!response.ok || !response.data?.id) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const [orgsByUser, platformRoleByUser] = await Promise.all([
      this.fetchOrgMembershipsByUser([userId]),
      this.fetchPlatformRoles(),
    ]);
    return {
      user: this.toListedUser(
        response.data,
        orgsByUser.get(userId),
        platformRoleByUser.get(userId) ?? null,
      ),
    };
  }

  async updateUser(userId: string, dto: UpdatePlatformUserDto, actorUserId: string) {
    const payload: { email?: string; user_metadata?: Record<string, unknown> } = {};
    if (dto.email !== undefined) {
      payload.email = dto.email.trim().toLowerCase();
    }
    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      payload.user_metadata = { display_name: trimmed.length > 0 ? trimmed : null };
    }
    if (Object.keys(payload).length === 0) {
      // No-op
      return this.getUser(userId);
    }
    const response = await this.supabase.updateAuthAdminUser(userId, payload);
    if (!response.ok) {
      this.logger.warn(`Could not update Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not update platform account');
    }
    await this.writeAuditLog(actorUserId, 'user.update', 'user', userId, {
      email: payload.email ?? undefined,
      display_name_set: payload.user_metadata !== undefined,
    });
    return this.getUser(userId);
  }

  async addOrgMembership(
    userId: string,
    organizationId: string,
    role: OrgRole,
    actorUserId: string,
  ): Promise<UserOrgMembership> {
    if (!ORG_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    // Super-admins are platform-scoped; they must not belong to any org.
    // Mirror check in OrganizationsService.addMember.
    await this.assertNotSuperAdmin(userId);
    const { data: existing } = await this.supabase.service
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (existing) {
      throw new ConflictException('User already belongs to this organization');
    }
    const { error } = await this.supabase.service
      .from('organization_members')
      .insert({ user_id: userId, organization_id: organizationId, role });
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'user.org_membership.add', 'user', userId, {
      organization_id: organizationId,
      role,
    });

    const { data: org } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug')
      .eq('id', organizationId)
      .maybeSingle();
    return {
      id: organizationId,
      name: (org as { name?: string } | null)?.name ?? '',
      slug: (org as { slug?: string } | null)?.slug ?? '',
      role,
    };
  }

  async updateOrgMembershipRole(
    userId: string,
    organizationId: string,
    role: OrgRole,
    actorUserId: string,
  ) {
    if (!ORG_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .update({ role })
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Membership not found');
    await this.writeAuditLog(actorUserId, 'user.org_membership.update', 'user', userId, {
      organization_id: organizationId,
      role,
    });
    return { userId, organizationId, role };
  }

  async removeOrgMembership(userId: string, organizationId: string, actorUserId: string) {
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Membership not found');
    await this.writeAuditLog(actorUserId, 'user.org_membership.remove', 'user', userId, {
      organization_id: organizationId,
    });
    return { userId, organizationId };
  }

  private async fetchOrgMembershipsByUser(
    userIds: string[],
  ): Promise<Map<string, UserOrgMembership[]>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .select('user_id, role, organizations(id, name, slug)')
      .in('user_id', userIds);
    if (error) {
      this.logger.warn(`Could not fetch org memberships: ${error.message}`);
      return new Map();
    }
    const map = new Map<string, UserOrgMembership[]>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const userId = row['user_id'] as string;
      const org = row['organizations'] as { id?: string; name?: string; slug?: string } | null;
      if (!org?.id) continue;
      const entry: UserOrgMembership = {
        id: org.id,
        name: org.name ?? '',
        slug: org.slug ?? '',
        role: (row['role'] as OrgRole) ?? 'read_only',
      };
      const list = map.get(userId) ?? [];
      list.push(entry);
      map.set(userId, list);
    }
    return map;
  }

  async createPlatformUser(input: CreatePlatformUserDto, actorUserId: string) {
    const temporaryPassword = generateTemporaryPassword();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim();

    const response = await this.supabase.createAuthAdminUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: displayName ? { display_name: displayName } : undefined,
    });
    if (!response.ok || !response.data?.id) {
      this.logger.warn(`Could not create Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not create platform account');
    }

    if (input.platformRole) {
      await this.writePlatformRole(response.data.id, input.platformRole);
    }

    // Vault the temp password so a super-admin can re-reveal it on the
    // user-detail page until the user changes it themselves. The
    // `supabase_updated_at` baseline is what lets the reveal endpoint
    // detect "the user has set their own password" without a webhook.
    const supabaseUpdatedAt = response.data.updated_at ?? new Date().toISOString();
    await this.supabase.service.from('admin_user_temp_passwords').upsert(
      {
        user_id: response.data.id,
        password: temporaryPassword,
        supabase_updated_at: supabaseUpdatedAt,
      },
      { onConflict: 'user_id' },
    );

    await this.writeAuditLog(actorUserId, 'user.create', 'user', response.data.id, {
      target_email: email,
      platform_role_granted: input.platformRole ?? null,
    });

    return {
      user: {
        id: response.data.id,
        email: response.data.email ?? email,
        created: true,
      },
      temporaryPassword,
      platformRole: input.platformRole ?? null,
    };
  }

  /**
   * Reveal the temp password for a freshly-created user. Resolves to
   * one of three statuses:
   *   - 'active'           — password still valid, returned to caller.
   *   - 'password_changed' — Supabase Auth updated_at has moved past
   *                          the baseline we recorded; row wiped.
   *   - 'expired'          — row missing (never created or already
   *                          locked via the explicit lock endpoint).
   *
   * The original migration shipped with a 7-day wall-clock TTL on the
   * vault row; operators kept hitting it whenever the new user took
   * longer than a week to log in (vacation, slow rollout). Migration
   * 0093 dropped that column; lock is now action-driven only —
   * either the user changes their password, or the super admin hits
   * the explicit lock endpoint.
   *
   * Every successful reveal writes `user.temp_password.reveal` to the
   * audit log. The plaintext is never logged.
   */
  async revealTempPassword(
    userId: string,
    actorUserId: string,
  ): Promise<{ status: 'active'; password: string } | { status: 'password_changed' | 'expired' }> {
    const { data: row } = await this.supabase.service
      .from('admin_user_temp_passwords')
      .select('password, supabase_updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (!row) return { status: 'expired' };
    const stored = row as {
      password: string;
      supabase_updated_at: string;
    };

    // Pull current Supabase state to detect a password change since we
    // vaulted. The fetch is on the GoTrue admin API; same surface used
    // by listUsers.
    const fresh = await this.supabase.getAuthAdminUser(userId);
    const currentUpdatedAt = fresh.data?.updated_at;
    if (
      currentUpdatedAt &&
      new Date(currentUpdatedAt).getTime() > new Date(stored.supabase_updated_at).getTime()
    ) {
      await this.wipeTempPasswordRow(userId);
      return { status: 'password_changed' };
    }

    await this.writeAuditLog(actorUserId, 'user.temp_password.reveal', 'user', userId, {});
    return { status: 'active', password: stored.password };
  }

  /**
   * Super-admin lock: wipe the temp password row even if the user
   * hasn't changed their password yet. Used when the admin decides the
   * temp credential has been over-shared.
   */
  async lockTempPassword(userId: string, actorUserId: string): Promise<{ status: 'locked' }> {
    await this.wipeTempPasswordRow(userId);
    await this.writeAuditLog(actorUserId, 'user.temp_password.lock', 'user', userId, {});
    return { status: 'locked' };
  }

  private async wipeTempPasswordRow(userId: string): Promise<void> {
    await this.supabase.service.from('admin_user_temp_passwords').delete().eq('user_id', userId);
  }

  async disableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, '876000h', actorUserId, 'user.disable');
  }

  async enableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, 'none', actorUserId, 'user.enable');
  }

  async deletePlatformUser(
    userId: string,
    actorUserId: string,
    mode: DeletePlatformUserMode,
  ): Promise<{ deleted: true; mode: DeletePlatformUserMode; cleanupApplied: boolean }> {
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    await this.ensureNotLastSuperAdmin(userId);
    const blockers = await this.collectDeletionBlockers(userId);
    if (blockers.soleOwnerOrganizationIds.length > 0) {
      throw new BadRequestException({
        message: 'This account owns organizations that would be left without an owner',
        blockers,
      });
    }

    if (mode === 'safe' && this.hasDeletionBlockers(blockers)) {
      throw new BadRequestException({
        message: 'This account still has MyClash references and cannot be safely deleted',
        blockers,
      });
    }

    if (mode === 'cleanup') {
      await this.cleanupUserReferences(userId);
    }

    const response = await this.supabase.deleteAuthAdminUser(userId);
    if (!response.ok) {
      this.logger.warn(`Could not delete Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not delete platform account');
    }

    await this.writeAuditLog(actorUserId, 'user.delete', 'user', userId, {
      mode,
      cleanup_applied: mode === 'cleanup',
    });
    return { deleted: true, mode, cleanupApplied: mode === 'cleanup' };
  }

  /**
   * Set the account's platform tier.
   *
   * One method for all three tiers rather than promote/demote pairs, because
   * `platform_roles.user_id` is the PRIMARY KEY: the tiers are mutually
   * exclusive by the table's shape, and a transition is one upsert.
   */
  async setPlatformRole(
    userId: string,
    role: PlatformRole,
    actorUserId: string,
  ): Promise<{ platformRole: PlatformRole }> {
    const response = await this.supabase.getAuthAdminUser(userId);
    if (!response.ok || !response.data?.id) throw new BadRequestException('User not found');

    if (userId === actorUserId && role !== 'super_admin') {
      throw new BadRequestException('You cannot demote yourself');
    }
    // DEMOTING the last super-admin locks everyone out just as thoroughly as
    // deleting them, so the guard has to run on a change of tier and not only
    // on a clear.
    if (role !== 'super_admin') await this.ensureNotLastSuperAdmin(userId);

    await this.writePlatformRole(userId, role);
    await this.writeAuditLog(actorUserId, 'user.platform_role.set', 'user', userId, {
      target_email: response.data.email,
      platform_role: role,
    });
    return { platformRole: role };
  }

  /** Remove the account's platform role entirely. */
  async clearPlatformRole(userId: string, actorUserId: string): Promise<{ platformRole: null }> {
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot remove your own platform role');
    }
    await this.ensureNotLastSuperAdmin(userId);

    const { error } = await this.supabase.service
      .from('platform_roles')
      .delete()
      .eq('user_id', userId);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'user.platform_role.clear', 'user', userId, {});
    return { platformRole: null };
  }

  /**
   * Every account holding `super_admin` exactly.
   *
   * Deliberately NOT every platform role: its only caller is the
   * last-super-admin guard, and counting admins or viewers there would let the
   * final super-admin be demoted as long as somebody, anybody, held a lesser
   * tier — locking the reserve out of its own platform.
   */
  async listSuperAdmins(): Promise<Array<{ userId: string; createdAt: string }>> {
    const { data, error } = await this.supabase.service
      .from('platform_roles')
      .select('user_id, created_at')
      .eq('role', 'super_admin');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => ({
      userId: r['user_id'] as string,
      createdAt: r['created_at'] as string,
    }));
  }

  /** Upsert on the PK — the tiers are mutually exclusive by table shape. */
  private async writePlatformRole(userId: string, role: PlatformRole): Promise<void> {
    const { error } = await this.supabase.service
      .from('platform_roles')
      .upsert({ user_id: userId, role }, { onConflict: 'user_id' });
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Set a NEW one-time password and vault it, replacing whatever was there.
   *
   * The subtle part is step three. `revealTempPassword` decides "the user has
   * since set their own password" by comparing GoTrue's live `updated_at`
   * against the baseline stored here — so the baseline must be read back AFTER
   * the write. The create path gets this free because GoTrue's POST response
   * already carries the post-write timestamp; a PUT does not, and storing the
   * pre-change value would make the very first reveal report `password_changed`
   * and wipe the row the operator just generated.
   */
  async regenerateTempPassword(
    userId: string,
    actorUserId: string,
  ): Promise<{ status: 'active'; temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword();

    const updated = await this.supabase.updateAuthAdminUser(userId, {
      password: temporaryPassword,
    });
    if (!updated.ok) throw new BadRequestException('Could not reset the account password');

    const fresh = await this.supabase.getAuthAdminUser(userId);
    const supabaseUpdatedAt =
      fresh.data?.updated_at ?? updated.data?.updated_at ?? new Date().toISOString();

    const { error } = await this.supabase.service
      .from('admin_user_temp_passwords')
      .upsert(
        { user_id: userId, password: temporaryPassword, supabase_updated_at: supabaseUpdatedAt },
        { onConflict: 'user_id' },
      );
    if (error) throw new BadRequestException(error.message);

    // NEVER put the password in the payload: maskAuditPayload masks by key
    // suffix (email/phone/dob/ip/user_agent) and has no masker for it, so it
    // would land in audit_log in plaintext.
    await this.writeAuditLog(actorUserId, 'user.temp_password.regenerate', 'user', userId, {});
    return { status: 'active', temporaryPassword };
  }

  /**
   * Email the account a password-recovery link, so they choose their own.
   *
   * Same machinery as the public forgot-password flow. No email-enumeration
   * concern here, unlike that flow: the caller already knows the account
   * exists — they are looking at it.
   */
  async sendPasswordReset(userId: string, actorUserId: string): Promise<{ sent: true }> {
    const response = await this.supabase.getAuthAdminUser(userId);
    const email = response.data?.email;
    if (!response.ok || !email) throw new BadRequestException('User not found');

    const domain = this.config.get<string>('DOMAIN') ?? 'myclash.fr';
    const { data, error } = await this.supabase.service.auth.admin.generateLink({
      type: 'recovery',
      email,
      // Deliberately the participant app, even though both apps now have a
      // /reset-password page. The self-service flow returns you to the host you
      // asked from; here nobody asked — a staff member acted on the account's
      // behalf, and there is no requesting host to return to. Routing by whether
      // the target holds admin access would need `hasAdminAccess`, which is
      // private to AuthService and in a module this one does not import.
      options: { redirectTo: `https://app.${domain}/reset-password` },
    });
    if (error || !data?.properties?.action_link) {
      throw new BadRequestException('Could not generate a password reset link');
    }

    await this.mail.sendMagicLink({
      to: email,
      magicLink: data.properties.action_link,
      type: 'recovery',
    });

    // `target_email` is masked for free — maskAuditPayload keys off the suffix.
    await this.writeAuditLog(actorUserId, 'user.password_reset.send', 'user', userId, {
      target_email: email,
    });
    return { sent: true };
  }

  private async updateBan(
    userId: string,
    banDuration: string,
    actorUserId: string,
    action: string,
  ): Promise<void> {
    const response = await this.supabase.updateAuthAdminUser(userId, {
      ban_duration: banDuration,
    });
    if (!response.ok) throw new BadRequestException('Could not update platform account');

    await this.writeAuditLog(actorUserId, action, 'user', userId, {
      ban_duration: banDuration,
    });
  }

  private async ensureNotLastSuperAdmin(userId: string): Promise<void> {
    const superAdmins = await this.listSuperAdmins();
    const targetIsSuperAdmin = superAdmins.some((admin) => admin.userId === userId);
    if (targetIsSuperAdmin && superAdmins.length <= 1) {
      throw new BadRequestException('You cannot remove the last remaining super admin');
    }
  }

  private hasDeletionBlockers(blockers: UserDeletionBlockers): boolean {
    return (
      blockers.soleOwnerOrganizationIds.length > 0 ||
      Object.values(blockers.references).some((count) => count > 0)
    );
  }

  private async collectDeletionBlockers(userId: string): Promise<UserDeletionBlockers> {
    const anchors = await this.resolveAnchors(userId);

    const references: Record<string, number> = {};
    for (const check of REFERENCE_CHECKS) {
      references[check.key] = await this.countReferences(check, anchors);
    }

    return {
      references,
      soleOwnerOrganizationIds: await this.findSoleOwnerOrganizationIds(userId),
    };
  }

  /**
   * The ids a non-`uid` reach compares against, resolved once per delete.
   *
   * `global_persons.claimed_by_user_id` carries a partial UNIQUE index (0063),
   * so that set holds at most one id. `persons.claimed_by_user_id` does not —
   * an account can claim a roster row per event.
   */
  private async resolveAnchors(userId: string): Promise<Record<ReferenceReach, string[]>> {
    return {
      uid: [userId],
      person: await this.idsClaimedBy('persons', userId),
      global_person: await this.idsClaimedBy('global_persons', userId),
    };
  }

  private async idsClaimedBy(
    table: 'persons' | 'global_persons',
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from(table)
      .select('id')
      .eq('claimed_by_user_id', userId);
    if (error) throw new BadRequestException(`Could not inspect ${table} references`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  private async countReferences(
    check: ReferenceCheck,
    anchors: Record<ReferenceReach, string[]>,
  ): Promise<number> {
    const ids = anchors[check.reach];
    // No identity to compare against ⇒ nothing can reference it. Skipping here
    // also avoids a pointless `.in(col, [])` round-trip.
    if (ids.length === 0) return 0;

    let count = 0;
    for (const chunk of chunked(ids)) {
      const { data, error } = await this.supabase.service
        .from(check.table)
        .select(check.column)
        .in(check.column, chunk as string[]);
      if (error) throw new BadRequestException(`Could not inspect ${check.table} references`);
      count += Array.isArray(data) ? data.length : 0;
    }
    return count;
  }

  private async findSoleOwnerOrganizationIds(userId: string): Promise<string[]> {
    const { data: memberships, error } = await this.supabase.service
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('role', 'owner');
    if (error) throw new BadRequestException('Could not inspect organization ownership');

    const soleOwnerOrganizationIds: string[] = [];
    for (const membership of memberships ?? []) {
      const organizationId = membership['organization_id'] as string;
      const { data: owners, error: ownersError } = await this.supabase.service
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('role', 'owner');
      if (ownersError) throw new BadRequestException('Could not inspect organization ownership');
      if ((owners ?? []).length <= 1) soleOwnerOrganizationIds.push(organizationId);
    }

    return soleOwnerOrganizationIds;
  }

  /**
   * Remove the private links, keep the historical facts — the contract the
   * button's own copy states ("Historical event facts remain").
   *
   * Every row deleted here is keyed by the auth uid and owned outright by the
   * login. Event-scoped rows are NOT deleted; the claim-nulling below unlinks
   * them from the account while leaving the event record standing.
   */
  private async cleanupUserReferences(userId: string): Promise<void> {
    for (const deletion of CLEANUP_DELETIONS) {
      const { error } = await this.supabase.service
        .from(deletion.table)
        .delete()
        .eq(deletion.column, userId);
      if (error) throw new BadRequestException(`Could not clean up ${deletion.table}`);
    }

    const { error: personsError } = await this.supabase.service
      .from('persons')
      .update({ claimed_by_user_id: null, claim_status: 'unclaimed' })
      .eq('claimed_by_user_id', userId);
    if (personsError) throw new BadRequestException('Could not unlink event persons');

    const { error: globalPersonsError } = await this.supabase.service
      .from('global_persons')
      .update({ claimed_by_user_id: null })
      .eq('claimed_by_user_id', userId);
    if (globalPersonsError) throw new BadRequestException('Could not unlink global persons');
  }

  /**
   * Best-effort: an audit failure must never fail the mutation it describes.
   * Personal values in `payload` are masked by insertAuditLog — this service
   * passes user emails, which used to land raw.
   */
  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType,
      entityId,
      payload,
    });
    if (error) {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }

  /**
   * All distinct `auth.users` ids holding at least one organization membership
   * — the organiser-scope predicate.
   *
   * Pages explicitly with `.range()`. The previous version issued a bare
   * `select('user_id')` and relied on PostgREST's default 1000-row cap, which
   * meant that past a thousand memberships it silently dropped organisers from
   * the listing: they simply were not there, with no error and no warning.
   */
  private async fetchAllOrgMemberUserIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.supabase.service
        .from('organization_members')
        .select('user_id')
        .range(offset, offset + pageSize - 1);
      if (error) {
        this.logger.warn(`Could not fetch org member ids: ${error.message}`);
        return ids;
      }
      const rows = (data ?? []) as Array<{ user_id?: string }>;
      for (const row of rows) {
        if (typeof row.user_id === 'string') ids.add(row.user_id);
      }
      if (rows.length < pageSize) return ids;
    }
  }

  private toListedUser(
    user: SupabaseAdminUser,
    organizations: UserOrgMembership[] = [],
    platformRole: PlatformRole | null = null,
  ): ListedPlatformUser {
    return {
      ...user,
      display_name: this.normalizeDisplayName(user),
      organizations,
      platform_role: platformRole,
    };
  }

  /**
   * Throws if `userId` holds the platform-level super-admin role.
   *
   * `super_admin`-EXACT, and deliberately NOT widened to the other tiers.
   * A super-admin bypasses every org check, so an org membership on top of it
   * means nothing and only muddies who actually has authority over an org.
   * A platform_admin or platform_viewer gets no such bypass from
   * `assertOrgRole`, so they can legitimately also be an organiser of their own
   * club — which is the normal case for a HEMA practitioner who also moderates
   * the platform, and is exactly the overlap the accounts console is built to
   * show on both its Platform and Organiser tabs.
   *
   * Forward-only, as before: it blocks ADDING a membership, and says nothing
   * about accounts that already hold one.
   */
  private async assertNotSuperAdmin(userId: string): Promise<void> {
    if (await hasPlatformTier(this.supabase, userId, 'super_admin')) {
      throw new ForbiddenException(
        'Cannot add a super-admin to an organization. Revoke super-admin status first.',
      );
    }
  }

  private userMatchesSearch(user: ListedPlatformUser, normalizedSearch: string): boolean {
    return this.userSearchTokens(user).some((token) => token.includes(normalizedSearch));
  }

  private userSearchScore(user: ListedPlatformUser, normalizedSearch: string): number {
    let score = 0;
    for (const token of this.userSearchTokens(user)) {
      if (token === normalizedSearch) score = Math.max(score, 100);
      else if (token.startsWith(normalizedSearch)) score = Math.max(score, 75);
      else if (token.includes(normalizedSearch)) score = Math.max(score, 50);
    }
    return score;
  }

  private userSearchTokens(user: ListedPlatformUser): string[] {
    return [user.display_name, user.email, user.id].filter(Boolean).map((value) => {
      return normalizeSearch(String(value));
    });
  }

  /**
   * Resolve a human-readable name for the account. Explicit `display_name`
   * (set via the admin form) wins; otherwise we fall back to the name fields
   * that OAuth providers populate on first sign-in (Google sets `full_name`
   * and `name`, sometimes `given_name`/`family_name`), so a self-signup login
   * shows its real name instead of a blank cell.
   */
  private normalizeDisplayName(user: SupabaseAdminUser): ListedPlatformUser['display_name'] {
    const metadata = user.user_metadata ?? {};
    const candidates: unknown[] = [
      metadata['display_name'],
      metadata['full_name'],
      metadata['name'],
      joinName(metadata['given_name'], metadata['family_name']),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
  }
}

function joinName(given: unknown, family: unknown): string {
  return [given, family]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
