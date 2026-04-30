import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PhasesService } from './phases.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PhasesService', () => {
  let service: PhasesService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new PhasesService(mockSupabase as never);
  });

  // ── generatePools — idempotency ───────────────────────────────────────────

  describe('generatePools — idempotency', () => {
    it('throws ConflictException when pool phase already exists (no force)', async () => {
      // Phase exists
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'phase-1' }, error: null }),
      });

      await expect(
        service.generatePools('tournament-1', {}, false),
      ).rejects.toThrow(ConflictException);
    });

    it('deletes existing phase and regenerates when force=true', async () => {
      const deleteChain = {
        ...makeChain({ data: null, error: null }),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      // Sequence: phase check → delete → registrations → phase insert → pool insert → pool_members → matches
      fromMock
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'old-phase' }, error: null }) })
        .mockReturnValueOnce(deleteChain)
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), then: (r: (v: unknown) => void) => r({ data: [
          { id: 'r1', seed: 1, bib_number: null, persons: { club_id: 'club-1' } },
          { id: 'r2', seed: 2, bib_number: null, persons: { club_id: 'club-2' } },
          { id: 'r3', seed: 3, bib_number: null, persons: { club_id: 'club-1' } },
          { id: 'r4', seed: 4, bib_number: null, persons: { club_id: 'club-2' } },
        ], error: null }) })
        .mockReturnValue({ ...makeChain({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: { id: 'new-phase' }, error: null }) });

      // Should not throw
      await expect(
        service.generatePools('tournament-1', { poolCount: 2 }, true),
      ).resolves.toBeDefined();
    });

    it('throws BadRequestException when fewer than 2 fighters', async () => {
      fromMock
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), then: (r: (v: unknown) => void) => r({ data: [{ id: 'r1', seed: 1, bib_number: null, persons: null }], error: null }) });

      await expect(
        service.generatePools('tournament-1', {}, false),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── generateBracket — idempotency ─────────────────────────────────────────

  describe('generateBracket — idempotency', () => {
    it('throws ConflictException when bracket phase already exists (no force)', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'phase-1' }, error: null }),
      });

      await expect(
        service.generateBracket('tournament-1', {}, false),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when fewer than 2 fighters qualify', async () => {
      fromMock
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), then: (r: (v: unknown) => void) => r({ data: [{ id: 'r1' }], error: null }) });

      await expect(
        service.generateBracket('tournament-1', {}, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates bracket with correct structure for 8 fighters', async () => {
      fromMock
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), then: (r: (v: unknown) => void) => r({ data: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` })), error: null }) })
        .mockReturnValue({ ...makeChain({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: { id: 'phase-new' }, error: null }) });

      const result = await service.generateBracket('tournament-1', {}, false);
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { rounds: number }).rounds).toBe(3);
      expect((result as { byeCount: number }).byeCount).toBe(0);
      expect((result as { totalSlots: number }).totalSlots).toBe(7); // 4+2+1
    });

    it('respects explicit bracketSize option', async () => {
      fromMock
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })
        .mockReturnValueOnce({ ...makeChain({ data: null, error: null }), then: (r: (v: unknown) => void) => r({ data: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}` })), error: null }) })
        .mockReturnValue({ ...makeChain({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: { id: 'phase-new' }, error: null }) });

      const result = await service.generateBracket('tournament-1', { bracketSize: 8 }, false);
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { byeCount: number }).byeCount).toBe(2); // 8-6=2 byes
    });
  });
});
