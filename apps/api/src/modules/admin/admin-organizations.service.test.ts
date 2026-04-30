import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminOrganizationsService } from './admin-organizations.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
  anon: {},
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
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new AdminOrganizationsService(mockSupabase as never);
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
      const mockOrgs = [
        {
          id: 'org-1',
          name: 'Lyon AMHE',
          slug: 'lyon-amhe',
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

  describe('getOrganization', () => {
    it('throws NotFoundException when org not found', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.getOrganization('nonexistent-id')).rejects.toThrow(NotFoundException);
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
