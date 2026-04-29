import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new OrganizationsService(mockSupabase as never);
  });

  describe('create', () => {
    it('creates with status=pending_approval', async () => {
      // slug check: not taken
      const slugChain = { ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
      const insertChain = { ...makeChain({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: { id: 'org-1', status: 'pending_approval' }, error: null }) };
      const memberChain = { ...makeChain({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ data: null, error: null }) };

      fromMock
        .mockReturnValueOnce(slugChain)
        .mockReturnValueOnce(insertChain)
        .mockReturnValueOnce(memberChain);

      const result = await service.create({ name: 'Test Org', slug: 'test-org' }, 'user-1');
      expect((result as { status: string }).status).toBe('pending_approval');
    });

    it('throws ConflictException when slug is taken', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }),
      });

      await expect(
        service.create({ name: 'Test', slug: 'taken-slug' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approve', () => {
    it('sets status to active', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: 'org-1', status: 'active' }, error: null }),
      });

      const result = await service.approve('org-1');
      expect((result as { status: string }).status).toBe('active');
    });
  });

  describe('assertOrgRole', () => {
    it('throws ForbiddenException when user is not a member', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(
        service.assertOrgRole('org-1', 'user-1', 'admin'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when role is insufficient', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'read_only' }, error: null }),
      });

      await expect(
        service.assertOrgRole('org-1', 'user-1', 'admin'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('passes when user has sufficient role', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
      });

      await expect(
        service.assertOrgRole('org-1', 'user-1', 'admin'),
      ).resolves.not.toThrow();
    });
  });
});
