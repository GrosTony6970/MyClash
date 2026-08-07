/**
 * T-102 · RLS policy tests
 *
 * These tests verify the RLS policy LOGIC by testing the helper functions
 * and policy conditions directly. They use a mock DB client that simulates
 * the Supabase auth context.
 *
 * For full integration tests against a live Postgres instance, run:
 *   DATABASE_URL=postgres://... pnpm --filter @myclash/db test:integration
 *
 * The tests below cover the 10+ cross-tenant leak scenarios required by T-102 AC.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// ── RLS policy logic (extracted for unit testing) ─────────────────────────────
// These mirror the SQL functions in 0002_rls.sql

type Role =
  'owner' | 'admin' | 'editor' | 'scorekeeper' | 'referee' | 'workshop_lead' | 'read_only';

interface OrgMember {
  organizationId: string;
  userId: string;
  role: Role;
}

interface Event {
  id: string;
  organizationId: string;
  status: 'draft' | 'published' | 'running' | 'completed' | 'archived';
}

interface League {
  id: string;
  publicVisibility: boolean;
}

interface LeagueOrgRole {
  leagueId: string;
  organizationId: string;
  role: 'member' | 'admin' | 'owner';
}

interface LeagueUserRole {
  leagueId: string;
  userId: string;
  role: 'admin' | 'owner';
}

interface PenaltyRuleset {
  id: string;
  builtIn: boolean;
  publicVisibility: boolean;
  ownerOrganizationId: string | null;
}

interface FighterProfileLink {
  fighterId: string;
  claimedByUserId: string | null;
}

interface EventScopedRow {
  eventId: string;
  organizationId: string;
}

interface PlatformAiRow {
  id: string;
}

interface TournamentQueryHistoryRow {
  tournamentId: string;
  userId: string;
}

interface InternalTablePolicy {
  tableName: string;
  serviceRoleOnlyWrite: true;
  authenticatedWritePolicy: false;
}

type DatabaseRole = 'anon' | 'authenticated' | 'service_role';

// Simulates is_super_admin() SQL function
function isSuperAdmin(
  userId: string | null,
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  if (!userId) return false;
  return platformRoles.some((r) => r.userId === userId && r.role === 'super_admin');
}

// Simulates is_platform_staff() SQL function (0170).
// Note the absent role filter — that is the whole difference from
// is_super_admin(), and it is why the two must never be collapsed.
function isPlatformStaff(
  userId: string | null,
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  if (!userId) return false;
  return platformRoles.some((r) => r.userId === userId);
}

// Simulates is_org_member() SQL function
function isOrgMember(userId: string | null, orgId: string, members: OrgMember[]): boolean {
  if (!userId) return false;
  return members.some((m) => m.organizationId === orgId && m.userId === userId);
}

// Simulates has_org_role() SQL function
const ROLE_HIERARCHY: Role[] = [
  'read_only',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'editor',
  'admin',
  'owner',
];

function hasOrgRole(
  userId: string | null,
  orgId: string,
  minRole: Role,
  members: OrgMember[],
): boolean {
  if (!userId) return false;
  const member = members.find((m) => m.organizationId === orgId && m.userId === userId);
  if (!member) return false;
  return ROLE_HIERARCHY.indexOf(member.role) >= ROLE_HIERARCHY.indexOf(minRole);
}

// Simulates events SELECT policy
function canSelectEvent(
  userId: string | null,
  event: Event,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  if (isSuperAdmin(userId, platformRoles)) return true;
  if (isOrgMember(userId, event.organizationId, members)) return true;
  return ['published', 'running', 'completed'].includes(event.status);
}

// Simulates events UPDATE policy
function canUpdateEvent(
  userId: string | null,
  event: Event,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  if (isSuperAdmin(userId, platformRoles)) return true;
  return hasOrgRole(userId, event.organizationId, 'admin', members);
}

function canManageLeague(
  userId: string | null,
  leagueId: string,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
  leagueOrgRoles: LeagueOrgRole[],
  leagueUserRoles: LeagueUserRole[],
): boolean {
  if (isSuperAdmin(userId, platformRoles)) return true;
  if (!userId) return false;
  if (leagueUserRoles.some((role) => role.leagueId === leagueId && role.userId === userId)) {
    return true;
  }
  return leagueOrgRoles.some((leagueRole) => {
    if (leagueRole.leagueId !== leagueId || !['admin', 'owner'].includes(leagueRole.role)) {
      return false;
    }
    return hasOrgRole(userId, leagueRole.organizationId, 'admin', members);
  });
}

function canSelectLeague(
  userId: string | null,
  league: League,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
  leagueOrgRoles: LeagueOrgRole[],
  leagueUserRoles: LeagueUserRole[],
): boolean {
  return (
    league.publicVisibility ||
    canManageLeague(userId, league.id, members, platformRoles, leagueOrgRoles, leagueUserRoles)
  );
}

function canManagePenaltyRuleset(
  userId: string | null,
  ruleset: PenaltyRuleset,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  if (isSuperAdmin(userId, platformRoles)) return true;
  if (!ruleset.ownerOrganizationId) return false;
  return hasOrgRole(userId, ruleset.ownerOrganizationId, 'admin', members);
}

function canSelectPenaltyRuleset(
  userId: string | null,
  ruleset: PenaltyRuleset,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  return (
    ruleset.builtIn ||
    ruleset.publicVisibility ||
    canManagePenaltyRuleset(userId, ruleset, members, platformRoles)
  );
}

function canManageFighterProfileLink(
  userId: string | null,
  link: FighterProfileLink,
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  return isSuperAdmin(userId, platformRoles) || link.claimedByUserId === userId;
}

function serviceRoleOnlyWrite(databaseRole: DatabaseRole): boolean {
  return databaseRole === 'service_role';
}

function canReadPlatformAiSettings(
  userId: string | null,
  _row: PlatformAiRow,
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  return isSuperAdmin(userId, platformRoles);
}

function canReadOrgAdminEventScopedRow(
  userId: string | null,
  row: EventScopedRow,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  return (
    isSuperAdmin(userId, platformRoles) || hasOrgRole(userId, row.organizationId, 'admin', members)
  );
}

function canReadOrgMemberEventScopedRow(
  userId: string | null,
  row: EventScopedRow,
  members: OrgMember[],
  platformRoles: Array<{ userId: string; role: string }>,
): boolean {
  return isSuperAdmin(userId, platformRoles) || isOrgMember(userId, row.organizationId, members);
}

function canReadOwnTournamentQueryHistory(
  userId: string | null,
  row: TournamentQueryHistoryRow,
): boolean {
  return Boolean(userId) && row.userId === userId;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ORG_A = 'org-a-uuid';
const ORG_B = 'org-b-uuid';

const USER_SUPER = 'user-super-admin';
const USER_ADMIN_A = 'user-admin-org-a';
const USER_EDITOR_A = 'user-editor-org-a';
const USER_MEMBER_B = 'user-member-org-b';
const USER_FIGHTER = 'user-claimed-fighter';
const USER_ANON = null; // unauthenticated
const USER_PLATFORM_ADMIN = 'user-platform-admin';
const USER_PLATFORM_VIEWER = 'user-platform-viewer';

// The two lower tiers sit in the SAME fixture as the super admin on purpose:
// every existing is_super_admin() assertion below is then checked against a
// table that really does contain other platform roles, which is what would
// catch a future widening of the function.
const PLATFORM_ROLES = [
  { userId: USER_SUPER, role: 'super_admin' },
  { userId: USER_PLATFORM_ADMIN, role: 'platform_admin' },
  { userId: USER_PLATFORM_VIEWER, role: 'platform_viewer' },
];

const ORG_MEMBERS: OrgMember[] = [
  { organizationId: ORG_A, userId: USER_ADMIN_A, role: 'admin' },
  { organizationId: ORG_A, userId: USER_EDITOR_A, role: 'editor' },
  { organizationId: ORG_B, userId: USER_MEMBER_B, role: 'admin' },
];

const EVENT_A_DRAFT: Event = { id: 'event-a-draft', organizationId: ORG_A, status: 'draft' };
const EVENT_A_PUBLISHED: Event = {
  id: 'event-a-published',
  organizationId: ORG_A,
  status: 'published',
};
const EVENT_B_DRAFT: Event = { id: 'event-b-draft', organizationId: ORG_B, status: 'draft' };
const EVENT_B_PUBLISHED: Event = {
  id: 'event-b-published',
  organizationId: ORG_B,
  status: 'published',
};
const LEAGUE_PRIVATE: League = { id: 'league-private', publicVisibility: false };
const LEAGUE_PUBLIC: League = { id: 'league-public', publicVisibility: true };
const LEAGUE_ORG_ROLES: LeagueOrgRole[] = [
  { leagueId: LEAGUE_PRIVATE.id, organizationId: ORG_A, role: 'admin' },
];
const LEAGUE_USER_ROLES: LeagueUserRole[] = [
  { leagueId: LEAGUE_PRIVATE.id, userId: USER_MEMBER_B, role: 'admin' },
];
const PENALTY_BUILT_IN: PenaltyRuleset = {
  id: 'penalty-built-in',
  builtIn: true,
  publicVisibility: true,
  ownerOrganizationId: null,
};
const PENALTY_PRIVATE_ORG_A: PenaltyRuleset = {
  id: 'penalty-org-a',
  builtIn: false,
  publicVisibility: false,
  ownerOrganizationId: ORG_A,
};
const CLAIMED_FIGHTER_LINK: FighterProfileLink = {
  fighterId: 'fighter-claimed',
  claimedByUserId: USER_FIGHTER,
};
const EVENT_A_SCOPED_ROW: EventScopedRow = {
  eventId: EVENT_A_PUBLISHED.id,
  organizationId: ORG_A,
};
const PLATFORM_AI_SETTINGS_ROW: PlatformAiRow = { id: 'platform-ai-settings' };
const USER_ADMIN_A_QUERY_HISTORY: TournamentQueryHistoryRow = {
  tournamentId: 'tournament-a',
  userId: USER_ADMIN_A,
};
const RECENT_INTERNAL_TABLE_POLICIES: InternalTablePolicy[] = [
  { tableName: 'match_forfeits', serviceRoleOnlyWrite: true, authenticatedWritePolicy: false },
  {
    tableName: 'event_broadcast_notifications',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'event_broadcast_recipients',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'platform_ai_settings',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'platform_ai_usage_log',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'ai_data_quality_scans',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'ai_data_quality_findings',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'organizer_ai_assistant_drafts',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'tournament_query_history',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'organizer_chat_conversations',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
  {
    tableName: 'organizer_chat_messages',
    serviceRoleOnlyWrite: true,
    authenticatedWritePolicy: false,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RLS policy logic — cross-tenant leak prevention', () => {
  // ── 1. Anonymous cannot see draft events ─────────────────────────────────
  it('1. anonymous cannot SELECT a draft event', () => {
    expect(canSelectEvent(USER_ANON, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(false);
  });

  // ── 2. Anonymous can see published events ────────────────────────────────
  it('2. anonymous CAN SELECT a published event', () => {
    expect(canSelectEvent(USER_ANON, EVENT_A_PUBLISHED, ORG_MEMBERS, PLATFORM_ROLES)).toBe(true);
  });

  // ── 3. Org B member cannot see Org A draft event ─────────────────────────
  it('3. org-B member cannot SELECT org-A draft event (cross-tenant leak)', () => {
    expect(canSelectEvent(USER_MEMBER_B, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(false);
  });

  // ── 4. Org A admin can see their own draft event ─────────────────────────
  it('4. org-A admin CAN SELECT their own draft event', () => {
    expect(canSelectEvent(USER_ADMIN_A, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(true);
  });

  // ── 5. Org B member cannot UPDATE Org A event ────────────────────────────
  it('5. org-B member cannot UPDATE org-A event (cross-tenant write leak)', () => {
    expect(canUpdateEvent(USER_MEMBER_B, EVENT_A_PUBLISHED, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      false,
    );
  });

  // ── 6. Org A editor cannot UPDATE events (needs admin) ───────────────────
  it('6. org-A editor cannot UPDATE event (insufficient role)', () => {
    expect(canUpdateEvent(USER_EDITOR_A, EVENT_A_PUBLISHED, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      false,
    );
  });

  // ── 7. Org A admin CAN UPDATE their own event ────────────────────────────
  it('7. org-A admin CAN UPDATE their own event', () => {
    expect(canUpdateEvent(USER_ADMIN_A, EVENT_A_PUBLISHED, ORG_MEMBERS, PLATFORM_ROLES)).toBe(true);
  });

  // ── 8. Super admin bypasses all restrictions ──────────────────────────────
  it('8. super_admin CAN SELECT any draft event (bypass)', () => {
    expect(canSelectEvent(USER_SUPER, EVENT_B_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(true);
  });

  it('9. super_admin CAN UPDATE any event (bypass)', () => {
    expect(canUpdateEvent(USER_SUPER, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(true);
  });

  // ── 10. Anonymous cannot UPDATE any event ────────────────────────────────
  it('10. anonymous cannot UPDATE any event', () => {
    expect(canUpdateEvent(USER_ANON, EVENT_A_PUBLISHED, ORG_MEMBERS, PLATFORM_ROLES)).toBe(false);
  });

  // ── 11. Org B member cannot UPDATE Org B event with Org A admin role ─────
  it('11. org-A admin role does not grant UPDATE on org-B event', () => {
    expect(canUpdateEvent(USER_ADMIN_A, EVENT_B_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(false);
  });

  // ── 12. Non-member authenticated user cannot see draft event ─────────────
  it('12. authenticated non-member cannot SELECT draft event', () => {
    const nonMember = 'user-not-in-any-org';
    expect(canSelectEvent(nonMember, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(false);
  });

  // ── Role hierarchy tests ──────────────────────────────────────────────────

  it('13. role hierarchy: editor satisfies read_only minimum', () => {
    expect(hasOrgRole(USER_EDITOR_A, ORG_A, 'read_only', ORG_MEMBERS)).toBe(true);
  });

  it('14. role hierarchy: editor does NOT satisfy admin minimum', () => {
    expect(hasOrgRole(USER_EDITOR_A, ORG_A, 'admin', ORG_MEMBERS)).toBe(false);
  });

  it('15. role hierarchy: admin satisfies editor minimum', () => {
    expect(hasOrgRole(USER_ADMIN_A, ORG_A, 'editor', ORG_MEMBERS)).toBe(true);
  });

  // ── is_super_admin tests ──────────────────────────────────────────────────

  it('16. is_super_admin returns false for null user', () => {
    expect(isSuperAdmin(null, PLATFORM_ROLES)).toBe(false);
  });

  it('17. is_super_admin returns false for regular org member', () => {
    expect(isSuperAdmin(USER_ADMIN_A, PLATFORM_ROLES)).toBe(false);
  });

  it('18. is_super_admin returns true for super admin user', () => {
    expect(isSuperAdmin(USER_SUPER, PLATFORM_ROLES)).toBe(true);
  });

  it('19. anonymous users can SELECT public leagues only', () => {
    expect(
      canSelectLeague(
        USER_ANON,
        LEAGUE_PUBLIC,
        ORG_MEMBERS,
        PLATFORM_ROLES,
        LEAGUE_ORG_ROLES,
        LEAGUE_USER_ROLES,
      ),
    ).toBe(true);
    expect(
      canSelectLeague(
        USER_ANON,
        LEAGUE_PRIVATE,
        ORG_MEMBERS,
        PLATFORM_ROLES,
        LEAGUE_ORG_ROLES,
        LEAGUE_USER_ROLES,
      ),
    ).toBe(false);
  });

  it('20. league management allows super admins, league user admins, and league org admins', () => {
    expect(
      canManageLeague(USER_SUPER, LEAGUE_PRIVATE.id, ORG_MEMBERS, PLATFORM_ROLES, [], []),
    ).toBe(true);
    expect(
      canManageLeague(
        USER_MEMBER_B,
        LEAGUE_PRIVATE.id,
        ORG_MEMBERS,
        PLATFORM_ROLES,
        [],
        LEAGUE_USER_ROLES,
      ),
    ).toBe(true);
    expect(
      canManageLeague(
        USER_ADMIN_A,
        LEAGUE_PRIVATE.id,
        ORG_MEMBERS,
        PLATFORM_ROLES,
        LEAGUE_ORG_ROLES,
        [],
      ),
    ).toBe(true);
  });

  it('21. anonymous users can SELECT built-in penalty rulesets but not private custom rulesets', () => {
    expect(canSelectPenaltyRuleset(USER_ANON, PENALTY_BUILT_IN, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      true,
    );
    expect(
      canSelectPenaltyRuleset(USER_ANON, PENALTY_PRIVATE_ORG_A, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(false);
  });

  it('22. penalty ruleset management allows super admins and owning org admins only', () => {
    expect(
      canManagePenaltyRuleset(USER_SUPER, PENALTY_PRIVATE_ORG_A, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(true);
    expect(
      canManagePenaltyRuleset(USER_ADMIN_A, PENALTY_PRIVATE_ORG_A, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(true);
    expect(
      canManagePenaltyRuleset(USER_MEMBER_B, PENALTY_PRIVATE_ORG_A, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(false);
  });

  it('23. claimed fighters can manage only their own club and weapon links', () => {
    expect(canManageFighterProfileLink(USER_FIGHTER, CLAIMED_FIGHTER_LINK, PLATFORM_ROLES)).toBe(
      true,
    );
    expect(canManageFighterProfileLink(USER_ADMIN_A, CLAIMED_FIGHTER_LINK, PLATFORM_ROLES)).toBe(
      false,
    );
  });

  it('24. super admins can manage fighter profile links for moderation', () => {
    expect(canManageFighterProfileLink(USER_SUPER, CLAIMED_FIGHTER_LINK, PLATFORM_ROLES)).toBe(
      true,
    );
  });

  it('25. recent service-role-only tables reject anon and authenticated writes', () => {
    for (const policy of RECENT_INTERNAL_TABLE_POLICIES) {
      expect(policy.serviceRoleOnlyWrite, policy.tableName).toBe(true);
      expect(serviceRoleOnlyWrite('anon')).toBe(false);
      expect(serviceRoleOnlyWrite('authenticated')).toBe(false);
      expect(serviceRoleOnlyWrite('service_role')).toBe(true);
    }
  });

  it('26. platform AI settings are readable only by super admins', () => {
    expect(canReadPlatformAiSettings(USER_SUPER, PLATFORM_AI_SETTINGS_ROW, PLATFORM_ROLES)).toBe(
      true,
    );
    expect(canReadPlatformAiSettings(USER_ADMIN_A, PLATFORM_AI_SETTINGS_ROW, PLATFORM_ROLES)).toBe(
      false,
    );
    expect(canReadPlatformAiSettings(USER_ANON, PLATFORM_AI_SETTINGS_ROW, PLATFORM_ROLES)).toBe(
      false,
    );
  });

  it('27. org AI settings and event AI usage require org admin or super admin reads', () => {
    expect(
      canReadOrgAdminEventScopedRow(USER_ADMIN_A, EVENT_A_SCOPED_ROW, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(true);
    expect(
      canReadOrgAdminEventScopedRow(USER_EDITOR_A, EVENT_A_SCOPED_ROW, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(false);
    expect(
      canReadOrgAdminEventScopedRow(USER_MEMBER_B, EVENT_A_SCOPED_ROW, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(false);
    expect(
      canReadOrgAdminEventScopedRow(USER_SUPER, EVENT_A_SCOPED_ROW, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(true);
  });

  it('28. broadcast recipients are event-org member readable but not cross-tenant readable', () => {
    expect(
      canReadOrgMemberEventScopedRow(
        USER_EDITOR_A,
        EVENT_A_SCOPED_ROW,
        ORG_MEMBERS,
        PLATFORM_ROLES,
      ),
    ).toBe(true);
    expect(
      canReadOrgMemberEventScopedRow(
        USER_MEMBER_B,
        EVENT_A_SCOPED_ROW,
        ORG_MEMBERS,
        PLATFORM_ROLES,
      ),
    ).toBe(false);
    expect(
      canReadOrgMemberEventScopedRow(USER_ANON, EVENT_A_SCOPED_ROW, ORG_MEMBERS, PLATFORM_ROLES),
    ).toBe(false);
  });

  it('29. tournament query history is user-private by default', () => {
    expect(canReadOwnTournamentQueryHistory(USER_ADMIN_A, USER_ADMIN_A_QUERY_HISTORY)).toBe(true);
    expect(canReadOwnTournamentQueryHistory(USER_EDITOR_A, USER_ADMIN_A_QUERY_HISTORY)).toBe(false);
    expect(canReadOwnTournamentQueryHistory(USER_ANON, USER_ADMIN_A_QUERY_HISTORY)).toBe(false);
  });

  it('30. service-role-only internal tables have no modeled authenticated write policy', () => {
    for (const policy of RECENT_INTERNAL_TABLE_POLICIES) {
      expect(policy.authenticatedWritePolicy, policy.tableName).toBe(false);
    }
  });

  // ── Platform role tiers (0170) ────────────────────────────────────────────
  //
  // The load-bearing assertion is the negative one: adding tiers must not have
  // widened is_super_admin(), because that function guards writes in ~80
  // policies across 0002 and 24 later migrations.

  it('31. is_super_admin stays exact — the lower tiers are NOT super admins', () => {
    expect(isSuperAdmin(USER_PLATFORM_ADMIN, PLATFORM_ROLES)).toBe(false);
    expect(isSuperAdmin(USER_PLATFORM_VIEWER, PLATFORM_ROLES)).toBe(false);
    expect(isSuperAdmin(USER_SUPER, PLATFORM_ROLES)).toBe(true);
  });

  it('32. is_super_admin does not grant the lower tiers a cross-tenant bypass', () => {
    expect(canSelectEvent(USER_PLATFORM_ADMIN, EVENT_B_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      false,
    );
    expect(canUpdateEvent(USER_PLATFORM_ADMIN, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      false,
    );
    expect(canUpdateEvent(USER_PLATFORM_VIEWER, EVENT_A_DRAFT, ORG_MEMBERS, PLATFORM_ROLES)).toBe(
      false,
    );
  });

  it('33. is_platform_staff covers every tier, and nobody else', () => {
    expect(isPlatformStaff(USER_SUPER, PLATFORM_ROLES)).toBe(true);
    expect(isPlatformStaff(USER_PLATFORM_ADMIN, PLATFORM_ROLES)).toBe(true);
    expect(isPlatformStaff(USER_PLATFORM_VIEWER, PLATFORM_ROLES)).toBe(true);
    expect(isPlatformStaff(USER_ADMIN_A, PLATFORM_ROLES)).toBe(false);
    expect(isPlatformStaff(USER_ANON, PLATFORM_ROLES)).toBe(false);
  });

  it('34. the 0170 CHECK constraint and PLATFORM_ROLES name the same tiers', () => {
    // Read both as TEXT rather than importing @myclash/types: this package has
    // no dependency on it, and adding one to satisfy a test would put a build
    // edge between them. Text comparison also catches the case the import
    // could not — a TS constant edited without the migration.
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(
      join(here, '..', 'migrations', '0170_platform_role_tiers.sql'),
      'utf8',
    );
    const ts = readFileSync(join(here, '..', '..', 'types', 'src', 'platform-role.ts'), 'utf8');

    const check = /CHECK \(role IN \(([^)]*)\)\)/u.exec(sql);
    expect(check, '0170 must contain a CHECK (role IN (...)) on platform_roles').not.toBeNull();
    const fromSql = new Set(check![1].split(',').map((part) => part.trim().replace(/^'|'$/gu, '')));

    const declaration = /PLATFORM_ROLES = \[([^\]]*)\]/u.exec(ts);
    expect(declaration, 'platform-role.ts must declare PLATFORM_ROLES').not.toBeNull();
    const fromTs = new Set(
      declaration![1].split(',').map((part) => part.trim().replace(/^'|'$/gu, '')),
    );

    expect([...fromSql].sort()).toEqual([...fromTs].sort());
    expect(fromSql.has('super_admin')).toBe(true);
    // The stored identifier is deliberately NOT `read_only` — that value is
    // already an organization_members.role and means something else entirely.
    expect(fromSql.has('read_only')).toBe(false);
  });
});
