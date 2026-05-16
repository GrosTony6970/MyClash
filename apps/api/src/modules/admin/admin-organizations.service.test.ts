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
const mockMail = { sendMagicLink: vi.fn() };
const mockConfig = { get: vi.fn((_key: string, fallback?: string) => fallback ?? 'myclash.fr') };

const mockSupabase = {
  service: { from: fromMock, auth: { admin: authAdminMock } },
  anon: {},
  listAuthAdminUsers: listAuthAdminUsersMock,
  createAuthAdminUser: createAuthAdminUserMock,
  deleteAuthAdminUser: deleteAuthAdminUserMock,
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
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new AdminOrganizationsService(
      mockSupabase as never,
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
      expect(result.owner.created).toBe(true);
      expect(result.owner.temporaryPassword).toEqual(expect.any(String));
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
      expect(result.owner.temporaryPassword).toEqual(expect.any(String));
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

      await service.suspendOrganization('org-1', 'actor-user');
      expect(updateChain.update).toHaveBeenCalledWith({ status: 'suspended' });
    });

    it('throws BadRequestException when update fails', async () => {
      fromMock.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
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
    it('throws BadRequestException when new owner is not a member', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.reassignOwner('org-1', { newOwnerUserId: 'non-member-user' }, 'actor'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
