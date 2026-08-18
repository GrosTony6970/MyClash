import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminOrganizationsService } from './admin-organizations.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const authAdminMock = {
  listUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  generateLink: vi.fn(),
};
const listAuthAdminUsersMock = vi.fn();
const createAuthAdminUserMock = vi.fn();
const deleteAuthAdminUserMock = vi.fn();
const getAuthAdminUserMock = vi.fn();
const mockMail = { sendMagicLink: vi.fn(), sendOwnerWelcomePassword: vi.fn() };
const mockConfig = { get: vi.fn((_key: string, fallback?: string) => fallback ?? 'myclash.fr') };

const mockSupabase = {
  service: { from: fromMock, auth: { admin: authAdminMock } },
  anon: {},
  listAuthAdminUsers: listAuthAdminUsersMock,
  createAuthAdminUser: createAuthAdminUserMock,
  deleteAuthAdminUser: deleteAuthAdminUserMock,
  getAuthAdminUser: getAuthAdminUserMock,
};

type ChainResult = { data: unknown; error: unknown };

/**
 * Creates a mock Supabase query chain.
 * Returns a plain object (NOT a Promise) so spreading it is ESLint-safe.
 * For `await chain` patterns, the service uses `.maybeSingle()` / `.single()`
 * as terminal calls — those return Promises.
 *
 * For `const { data, error } = await q` where `q` is the chain itself
 * (no terminal call), we use a real Promise via `Object.assign` but only
 * in the admin service's `listOrganizations` which catches all errors.
 */
function makeChain(result: ChainResult) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    ilike: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

/**
 * Creates a chain that is also awaitable (resolves to `result`).
 * Used for `await q` patterns where no terminal method is called.
 * The Promise is assigned via Object.assign — NOT spread — so ESLint is happy.
 */
function makeAwaitableChain(result: ChainResult) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of [
    'select',
    'eq',
    'ilike',
    'update',
    'insert',
    'delete',
    'upsert',
    'order',
    'limit',
    'in',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminOrganizationsService', () => {
  let service: AdminOrganizationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    listAuthAdminUsersMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { users: [] },
      detail: { users: [] },
    });
    createAuthAdminUserMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', email: 'owner@example.com' },
      detail: { id: 'user-new', email: 'owner@example.com' },
    });
    deleteAuthAdminUserMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {},
      detail: {},
    });
    authAdminMock.generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://auth.example/magic' } },
      error: null,
    });
    mockMail.sendMagicLink.mockResolvedValue(undefined);
    mockMail.sendOwnerWelcomePassword.mockResolvedValue(undefined);
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new AdminOrganizationsService(
      mockSupabase as never,
      { resolveUsers: vi.fn().mockResolvedValue(new Map()) } as never,
      mockMail as never,
      mockConfig as never,
    );
  });

  describe('createOrganizationWithOwner', () => {
    it('creates a new auth user, organization, owner membership, audit log, and magic link', async () => {
      const orgChain = makeChain({
        data: { id: 'org-1', name: 'Lyon AMHE', slug: 'lyon-amhe', status: 'active' },
        error: null,
      });
      const slugCheckChain = makeChain({ data: null, error: null });
      const memberChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      const auditChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      let orgCall = 0;

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? slugCheckChain : orgChain;
        }
        if (table === 'organization_members') return memberChain;
        if (table === 'audit_log') return auditChain;
        return makeChain({ data: null, error: null });
      });

      const result = await service.createOrganizationWithOwner(
        {
          name: 'Lyon AMHE',
          slug: 'lyon-amhe',
          ownerEmail: 'OWNER@example.com',
          ownerDisplayName: 'Owner Name',
        },
        'actor-user',
      );

      expect(listAuthAdminUsersMock).toHaveBeenCalledWith(1, 1000);
      expect(createAuthAdminUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'owner@example.com',
          email_confirm: true,
          user_metadata: { display_name: 'Owner Name' },
        }),
      );
      expect(result.organization).toEqual({
        id: 'org-1',
        name: 'Lyon AMHE',
        slug: 'lyon-amhe',
        status: 'active',
      });
      expect(result.owner).not.toBeNull();
      expect(result.owner!.created).toBe(true);
      expect(result.owner!.temporaryPassword).toEqual(expect.any(String));
      expect(memberChain.insert).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-new',
        role: 'owner',
      });
      expect(auditChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: 'actor-user',
          action: 'org.create_with_owner',
          entity_type: 'organization',
          entity_id: 'org-1',
        }),
      );
      expect(mockMail.sendMagicLink).toHaveBeenCalledOnce();
      expect(result.magicLinkSent).toBe(true);
      // The welcome email carries the credential, so it has to carry the SAME
      // one the caller was handed — an owner mailed a different password than
      // the console shows cannot sign in, and neither value is recoverable.
      expect(mockMail.sendOwnerWelcomePassword).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@example.com',
          displayName: 'Owner Name',
          orgName: 'Lyon AMHE',
          temporaryPassword: result.owner!.temporaryPassword,
          loginUrl: 'https://admin.myclash.localhost/login',
          orgUrl: 'https://admin.myclash.localhost/org/lyon-amhe',
        }),
      );
      expect(authAdminMock.listUsers).not.toHaveBeenCalled();
      expect(authAdminMock.createUser).not.toHaveBeenCalled();
    });

    it('reuses an existing organizer user without returning or resetting a password', async () => {
      listAuthAdminUsersMock.mockResolvedValue({
        ok: true,
        status: 200,
        data: { users: [{ id: 'user-existing', email: 'owner@example.com' }] },
        detail: { users: [{ id: 'user-existing', email: 'owner@example.com' }] },
      });
      const orgChain = makeChain({
        data: { id: 'org-2', name: 'Existing Org', slug: 'existing-org', status: 'active' },
        error: null,
      });
      const slugCheckChain = makeChain({ data: null, error: null });
      const memberChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      let orgCall = 0;

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? slugCheckChain : orgChain;
        }
        if (table === 'organization_members') return memberChain;
        if (table === 'audit_log')
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
        return makeChain({ data: null, error: null });
      });

      const result = await service.createOrganizationWithOwner(
        {
          name: 'Existing Org',
          slug: 'existing-org',
          ownerEmail: 'owner@example.com',
        },
        'actor-user',
      );

      expect(createAuthAdminUserMock).not.toHaveBeenCalled();
      expect(authAdminMock.createUser).not.toHaveBeenCalled();
      expect(result.owner).toEqual({
        userId: 'user-existing',
        email: 'owner@example.com',
        created: false,
      });
      expect(memberChain.insert).toHaveBeenCalledWith({
        organization_id: 'org-2',
        user_id: 'user-existing',
        role: 'owner',
      });
    });

    it('rejects reserved or taken slugs', async () => {
      await expect(
        service.createOrganizationWithOwner(
          {
            name: 'Admin Org',
            slug: 'admin',
            ownerEmail: 'owner@example.com',
          },
          'actor',
        ),
      ).rejects.toThrow('reserved');

      fromMock.mockReturnValue(makeChain({ data: { id: 'org-existing' }, error: null }));

      await expect(
        service.createOrganizationWithOwner(
          {
            name: 'Taken Org',
            slug: 'taken-org',
            ownerEmail: 'owner@example.com',
          },
          'actor',
        ),
      ).rejects.toThrow('already taken');
    });

    it('cleans up a newly created auth user when organization creation fails', async () => {
      const slugCheckChain = makeChain({ data: null, error: null });
      const orgCreateChain = makeChain({ data: null, error: { message: 'insert failed' } });
      let orgCall = 0;

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? slugCheckChain : orgCreateChain;
        }
        return makeChain({ data: null, error: null });
      });

      await expect(
        service.createOrganizationWithOwner(
          {
            name: 'Broken Org',
            slug: 'broken-org',
            ownerEmail: 'owner@example.com',
          },
          'actor',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(deleteAuthAdminUserMock).toHaveBeenCalledWith('user-new');
      expect(authAdminMock.deleteUser).not.toHaveBeenCalled();
    });

    it('returns a safe error when internal GoTrue user inspection fails', async () => {
      listAuthAdminUsersMock.mockResolvedValue({
        ok: false,
        status: 500,
        data: null,
        detail: { message: 'gotrue unavailable' },
      });
      fromMock.mockReturnValue(makeChain({ data: null, error: null }));

      await expect(
        service.createOrganizationWithOwner(
          {
            name: 'Inspect Fail',
            slug: 'inspect-fail',
            ownerEmail: 'owner@example.com',
          },
          'actor',
        ),
      ).rejects.toThrow('Could not inspect organizer accounts');

      expect(createAuthAdminUserMock).not.toHaveBeenCalled();
      expect(authAdminMock.listUsers).not.toHaveBeenCalled();
    });

    it('keeps creation successful when magic-link delivery fails', async () => {
      authAdminMock.generateLink.mockResolvedValue({
        data: { properties: {} },
        error: { message: 'email disabled' },
      });
      const orgChain = makeChain({
        data: { id: 'org-3', name: 'No Mail', slug: 'no-mail', status: 'active' },
        error: null,
      });
      const slugCheckChain = makeChain({ data: null, error: null });
      let orgCall = 0;

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? slugCheckChain : orgChain;
        }
        if (table === 'organization_members') {
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }
        if (table === 'audit_log') {
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.createOrganizationWithOwner(
        {
          name: 'No Mail',
          slug: 'no-mail',
          ownerEmail: 'owner@example.com',
        },
        'actor',
      );

      expect(result.magicLinkSent).toBe(false);
      expect(result.owner).not.toBeNull();
      expect(result.owner!.temporaryPassword).toEqual(expect.any(String));
    });

    it('creates an org without an owner when no owner inputs are provided', async () => {
      const orgChain = makeChain({
        data: { id: 'org-no-owner', name: 'No Owner Org', slug: 'no-owner-org', status: 'active' },
        error: null,
      });
      const slugCheckChain = makeChain({ data: null, error: null });
      const memberChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      const auditChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      let orgCall = 0;

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? slugCheckChain : orgChain;
        }
        if (table === 'organization_members') return memberChain;
        if (table === 'audit_log') return auditChain;
        return makeChain({ data: null, error: null });
      });

      const result = await service.createOrganizationWithOwner(
        { name: 'No Owner Org', slug: 'no-owner-org' },
        'actor-super-admin',
      );

      // No auth-user bootstrap should have run.
      expect(createAuthAdminUserMock).not.toHaveBeenCalled();
      expect(listAuthAdminUsersMock).not.toHaveBeenCalled();

      // Org row should be inserted with the super-admin as created_by.
      expect(orgChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'No Owner Org',
          slug: 'no-owner-org',
          created_by_user_id: 'actor-super-admin',
        }),
      );

      // No member row should be inserted.
      expect(memberChain.insert).not.toHaveBeenCalled();

      // Audit log should reflect the ownerless creation.
      expect(auditChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.create_without_owner',
          payload_json: expect.objectContaining({ owner_user_id: null, owner_created: false }),
        }),
      );

      // Response shape: no owner / no membership / no magic link.
      expect(result.owner).toBeNull();
      expect(result.membership).toBeNull();
      expect(result.magicLinkSent).toBe(false);
      expect(mockMail.sendMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('reassignOwner — assign-later flows', () => {
    function setupOrgFixture(opts: { currentOwnerUserId?: string }) {
      const orgExistsChain = makeChain({ data: { id: 'org-1' }, error: null });

      const hasCurrentOwner = !!opts.currentOwnerUserId;
      const currentOwnersChain = makeAwaitableChain({
        data: hasCurrentOwner ? [{ user_id: opts.currentOwnerUserId }] : [],
        error: null,
      });

      const demoteChain = makeChain({ data: null, error: null });

      const existingMemberChain = makeChain({ data: null, error: null });
      existingMemberChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertMemberChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };

      const auditChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };

      const orgRowChain = makeChain({
        data: { name: 'Test Org', slug: 'test-org' },
        error: null,
      });

      let orgCall = 0;
      let memberCall = 0;
      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') {
          orgCall += 1;
          return orgCall === 1 ? orgExistsChain : orgRowChain;
        }
        if (table === 'organization_members') {
          memberCall += 1;
          // Sequence:
          //   1: SELECT current owners
          //   2: UPDATE demote (skipped when no current owner)
          //   N-1: SELECT existing member row for new owner
          //   N: INSERT new owner member (when not already a member)
          if (memberCall === 1) return currentOwnersChain;
          if (hasCurrentOwner && memberCall === 2) return demoteChain;
          const positionAfterDemote = hasCurrentOwner ? memberCall - 1 : memberCall;
          if (positionAfterDemote === 2) return existingMemberChain;
          return insertMemberChain;
        }
        if (table === 'audit_log') return auditChain;
        return makeChain({ data: null, error: null });
      });

      return { auditChain, insertMemberChain, demoteChain };
    }

    it('assigns a brand-new owner via email on an ownerless org', async () => {
      const { auditChain, insertMemberChain, demoteChain } = setupOrgFixture({
        // no currentOwnerUserId → ownerless
      });

      const result = await service.reassignOwner(
        'org-1',
        { ownerEmail: 'new-owner@example.com', ownerDisplayName: 'New Owner' },
        'actor-super-admin',
      );

      // bootstrap creates the user
      expect(createAuthAdminUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new-owner@example.com' }),
      );
      // no demotion (no current owner)
      expect(demoteChain.update).not.toHaveBeenCalled();
      // member row inserted as owner
      expect(insertMemberChain.insert).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-new',
        role: 'owner',
      });
      // audit action distinguishes from reassign
      expect(auditChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.owner_assigned',
          payload_json: expect.objectContaining({ new_owner_user_id: 'user-new' }),
        }),
      );
      expect(result.action).toBe('org.owner_assigned');
      expect(result.ownerCreated).toBe(true);
    });

    it('reassigns ownership via existing userId on an org that already has an owner', async () => {
      // Existing platform user lookup → user-existing
      getAuthAdminUserMock.mockResolvedValue({
        ok: true,
        status: 200,
        data: { id: 'user-existing', email: 'existing@example.com', user_metadata: {} },
        detail: {},
      });

      const { auditChain, insertMemberChain, demoteChain } = setupOrgFixture({
        currentOwnerUserId: 'old-owner-user-id',
      });

      const result = await service.reassignOwner(
        'org-1',
        { ownerUserId: 'user-existing' },
        'actor-super-admin',
      );

      // Old owner demoted
      expect(demoteChain.update).toHaveBeenCalledWith({ role: 'admin' });
      // New owner inserted as member (since maybeSingle returned null)
      expect(insertMemberChain.insert).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-existing',
        role: 'owner',
      });
      // No new auth user created
      expect(createAuthAdminUserMock).not.toHaveBeenCalled();
      // Audit reflects reassignment, not first-time assignment
      expect(auditChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.owner_reassigned',
        }),
      );
      expect(result.action).toBe('org.owner_reassigned');
      expect(result.ownerCreated).toBe(false);
    });
  });

  describe('listOrganizations', () => {
    it('returns empty array when table does not exist', async () => {
      // Simulate a DB error — the service catches and returns []
      fromMock.mockReturnValue(
        makeAwaitableChain({
          data: null,
          error: { message: 'relation "organizations" does not exist' },
        }),
      );

      const result = await service.listOrganizations({});
      expect(result).toEqual([]);
    });

    it('returns mapped org list on success', async () => {
      listAuthAdminUsersMock.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          users: [
            {
              id: 'u1',
              email: 'owner@example.com',
              user_metadata: { display_name: 'Owner Name' },
            },
          ],
        },
        detail: {},
      });
      const mockOrgs = [
        {
          id: 'org-1',
          name: 'Lyon AMHE',
          slug: 'myclash-hq',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          organization_members: [{ user_id: 'u1', role: 'owner' }],
          events: [{ id: 'e1' }, { id: 'e2' }],
        },
      ];
      fromMock.mockReturnValue(makeAwaitableChain({ data: mockOrgs, error: null }));

      const result = await service.listOrganizations({});
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Lyon AMHE');
      expect(result[0]?.member_count).toBe(1);
      expect(result[0]?.event_count).toBe(2);
      expect(result[0]?.owner_email).toBe('owner@example.com');
      expect(result[0]?.owner_name).toBe('Owner Name');
      expect(result[0]?.owner_username).toBe('Owner Name');
      expect(result[0]?.is_protected).toBe(true);
    });
  });

  describe('suspendOrganization', () => {
    it('calls update with status=suspended and writes audit log', async () => {
      const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
      const orgChain = makeChain({ data: { slug: 'normal-org' }, error: null });
      orgChain.update.mockReturnValue({ eq: updateEq });
      const insertChain = {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return orgChain;
        if (table === 'audit_log') return insertChain;
        return makeChain({ data: null, error: null });
      });

      await service.suspendOrganization('org-1', 'actor-user');
      expect(orgChain.update).toHaveBeenCalledWith({ status: 'suspended' });
      expect(updateEq).toHaveBeenCalledWith('id', 'org-1');
    });

    it('refuses to suspend the protected MyClash HQ organization', async () => {
      const orgChain = makeChain({ data: { slug: 'myclash-hq' }, error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return orgChain;
        return makeChain({ data: null, error: null });
      });

      await expect(service.suspendOrganization('org-hq', 'actor-user')).rejects.toThrow(
        'The MyClash HQ organization cannot be suspended',
      );

      expect(orgChain.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when update fails', async () => {
      const orgChain = makeChain({ data: { slug: 'normal-org' }, error: null });
      orgChain.update.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });
      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return orgChain;
        return makeChain({ data: null, error: null });
      });

      await expect(service.suspendOrganization('org-1', 'actor')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('approveOrganization', () => {
    it('calls update with status=active and writes approve audit log', async () => {
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const insertChain = {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return updateChain;
        if (table === 'audit_log') return insertChain;
        return makeChain({ data: null, error: null });
      });

      await service.approveOrganization('org-1', 'actor-user');

      expect(updateChain.update).toHaveBeenCalledWith({ status: 'active' });
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: 'actor-user',
          action: 'org.approve',
          entity_type: 'organization',
          entity_id: 'org-1',
          payload_json: { status: 'active' },
        }),
      );
    });
  });

  describe('getOrganization', () => {
    it('throws NotFoundException when org not found', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.getOrganization('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('returns enriched organization members with display names and emails', async () => {
      listAuthAdminUsersMock.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          users: [
            {
              id: 'u1',
              email: 'owner@example.com',
              user_metadata: { display_name: 'Owner Name' },
            },
          ],
        },
        detail: {},
      });
      const orgChain = makeChain({
        data: {
          id: 'org-1',
          name: 'MyClash HQ',
          slug: 'myclash-hq',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          organization_members: [{ user_id: 'u1', role: 'owner', created_at: '2026-01-02' }],
          events: [],
        },
        error: null,
      });

      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return orgChain;
        if (table === 'audit_log') return makeChain({ data: [], error: null });
        return makeChain({ data: null, error: null });
      });

      const result = await service.getOrganization('org-1');

      expect(result.is_protected).toBe(true);
      expect(result.owner_email).toBe('owner@example.com');
      expect(result.owner_name).toBe('Owner Name');
      expect(result.members[0]).toEqual({
        user_id: 'u1',
        email: 'owner@example.com',
        display_name: 'Owner Name',
        username: 'Owner Name',
        role: 'owner',
        joined_at: '2026-01-02',
      });
    });
  });

  describe('deleteOrganization', () => {
    it('refuses to hard-delete the protected MyClash HQ organization', async () => {
      const protectedOrgChain = makeChain({ data: { slug: 'myclash-hq' }, error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'organizations') return protectedOrgChain;
        return makeChain({ data: null, error: null });
      });

      await expect(service.deleteOrganization('org-hq', 'actor')).rejects.toThrow(
        'The MyClash HQ organization cannot be deleted',
      );

      expect(protectedOrgChain.delete).not.toHaveBeenCalled();
    });
  });

  describe('reassignOwner', () => {
    it('throws BadRequestException when no owner identifier is provided', async () => {
      await expect(service.reassignOwner('org-1', {}, 'actor')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when both ownerUserId and ownerEmail are provided', async () => {
      await expect(
        service.reassignOwner(
          'org-1',
          { ownerUserId: 'user-1', ownerEmail: 'x@example.com' },
          'actor',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
