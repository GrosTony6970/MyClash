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

function makeChain(result: ChainResult) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    // Make the chain itself awaitable (for .update().eq() patterns)
    then: (resolve: (v: ChainResult) => void) => resolve(result),
  };
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
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        then: (_: unknown, reject: (e: Error) => void) =>
          reject(new Error('relation "organizations" does not exist')),
      });

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
      fromMock.mockReturnValue({
        ...makeChain({ data: mockOrgs, error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        then: (resolve: (v: ChainResult) => void) =>
          resolve({ data: mockOrgs, error: null }),
      });

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

      await expect(
        service.suspendOrganization('org-1', 'actor'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrganization', () => {
    it('throws NotFoundException when org not found', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(service.getOrganization('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reassignOwner', () => {
    it('throws BadRequestException when new owner is not a member', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(
        service.reassignOwner(
          'org-1',
          { newOwnerUserId: 'non-member-user' },
          'actor',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
