import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

/**
 * Creates a mock Supabase query chain.
 * Returns a plain object — NOT a Promise — so spreading it is safe.
 * For `await chain` patterns in the service, the service uses `.maybeSingle()`
 * or `.single()` as the terminal call, which return Promises.
 */
function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  return chain;
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
      const slugChain = makeChain({ data: null, error: null });
      slugChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'org-1', status: 'pending_approval' },
        error: null,
      });

      const memberChain = makeChain({ data: null, error: null });
      memberChain.insert.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(slugChain)
        .mockReturnValueOnce(insertChain)
        .mockReturnValueOnce(memberChain);

      const result = await service.create({ name: 'Test Org', slug: 'test-org' }, 'user-1');
      expect((result as { status: string }).status).toBe('pending_approval');
    });

    it('throws ConflictException when slug is taken', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'existing' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.create({ name: 'Test', slug: 'taken-slug' }, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('approve', () => {
    it('sets status to active', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.single.mockResolvedValue({ data: { id: 'org-1', status: 'active' }, error: null });
      fromMock.mockReturnValue(chain);

      const result = await service.approve('org-1');
      expect((result as { status: string }).status).toBe('active');
    });
  });

  describe('assertOrgRole', () => {
    it('throws ForbiddenException when user is not a member', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when role is insufficient', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { role: 'read_only' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('passes when user has sufficient role', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { role: 'owner' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).resolves.not.toThrow();
    });
  });
});
