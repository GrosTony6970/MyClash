import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PhasesService } from './phases.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };
const mockOrgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

/**
 * Creates a mock Supabase query chain.
 * Returns a plain object (NOT a Promise) — safe to use without spreading.
 * For `await q` patterns (no terminal call), use `makeAwaitableChain`.
 */
function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  return chain;
}

/**
 * Creates a chain that is also awaitable (resolves to `result`).
 * Used for `const { data, error } = await q` patterns where the service
 * awaits the chain directly (no terminal method call).
 */
function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  // Attach chain methods that return the promise itself (so await works after chaining)
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  // All builder methods return the chain (Promise) itself
  for (const key of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PhasesService', () => {
  let service: PhasesService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new PhasesService(mockSupabase as never, undefined, mockOrgs as never);
  });

  // ── generatePools — idempotency ───────────────────────────────────────────

  describe('generatePools — idempotency', () => {
    it('throws ConflictException when pool phase already exists (no force)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.generatePools('tournament-1', {}, false)).rejects.toThrow(
        ConflictException,
      );
    });

    it('deletes existing phase and regenerates when force=true', async () => {
      const regsData = [
        { id: 'r1', seed: 1, bib_number: null, persons: { club_id: 'club-1' } },
        { id: 'r2', seed: 2, bib_number: null, persons: { club_id: 'club-2' } },
        { id: 'r3', seed: 3, bib_number: null, persons: { club_id: 'club-1' } },
        { id: 'r4', seed: 4, bib_number: null, persons: { club_id: 'club-2' } },
      ];

      // Phase check: existing phase found
      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: { id: 'old-phase' }, error: null });

      // Delete chain
      const deleteChain = makeChain({ data: null, error: null });
      deleteChain.eq.mockResolvedValue({ data: null, error: null });

      // Registrations query (awaitable — service does `await q`)
      const regsChain = makeAwaitableChain({ data: regsData, error: null });

      // Phase insert
      const tournamentChain = makeChain({ data: { weapon: null }, error: null });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'new-phase' }, error: null });

      // Pool insert + pool_members + matches — use default chain
      const defaultChain = makeChain({ data: null, error: null });
      defaultChain.single.mockResolvedValue({ data: { id: 'pool-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(deleteChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(defaultChain);

      // Should not throw
      await expect(
        service.generatePools('tournament-1', { poolCount: 2 }, true),
      ).resolves.toBeDefined();
      expect(phaseInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility_status: 'hidden' }),
      );
    });

    it('throws BadRequestException when fewer than 2 fighters', async () => {
      const oneReg = [{ id: 'r1', seed: 1, bib_number: null, persons: null }];

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: oneReg, error: null });

      fromMock.mockReturnValueOnce(phaseCheckChain).mockReturnValueOnce(regsChain);

      await expect(service.generatePools('tournament-1', {}, false)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── generateBracket — idempotency ─────────────────────────────────────────

  describe('generateBracket — idempotency', () => {
    it('throws ConflictException when bracket phase already exists (no force)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.generateBracket('tournament-1', {}, false)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when fewer than 2 fighters qualify', async () => {
      const oneReg = [{ id: 'r1' }];

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: oneReg, error: null });

      fromMock.mockReturnValueOnce(phaseCheckChain).mockReturnValueOnce(regsChain);

      await expect(service.generateBracket('tournament-1', {}, false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates bracket with correct structure for 8 fighters', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
      const seededRegsChain = makeAwaitableChain({
        data: eightRegs.map((reg, index) => ({ ...reg, seed: index + 1, bib_number: null })),
        error: null,
      });

      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });

      const defaultChain = makeChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket('tournament-1', {}, false);
      expect(phaseInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility_status: 'hidden' }),
      );
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { rounds: number }).rounds).toBe(3);
      expect((result as { byeCount: number }).byeCount).toBe(0);
      expect((result as { totalSlots: number }).totalSlots).toBe(8); // 4+2+1+bronze
    });

    it('respects explicit bracketSize option', async () => {
      const sixRegs = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: sixRegs, error: null });
      const seededRegsChain = makeAwaitableChain({
        data: sixRegs.map((reg, index) => ({ ...reg, seed: index + 1, bib_number: null })),
        error: null,
      });

      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });

      const defaultChain = makeChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket('tournament-1', { bracketSize: 8 }, false);
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { byeCount: number }).byeCount).toBe(2); // 8-6=2 byes
    });
  });

  describe('updateVisibility', () => {
    it('publishes a phase and writes an audit log', async () => {
      const phaseChain = makeChain({ data: null, error: null });
      phaseChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-1',
          type: 'pool',
          visibility_status: 'hidden',
          tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
        },
        error: null,
      });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'phase-1', visibility_status: 'published' },
        error: null,
      });
      const auditChain = makeChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(auditChain);

      await expect(
        service.updateVisibility('phase-1', 'actor-1', { visibility: 'published' }),
      ).resolves.toMatchObject({ visibility_status: 'published' });
      expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'actor-1', 'admin');
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility_status: 'published',
          published_by_user_id: 'actor-1',
        }),
      );
      expect(auditChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'phase.visibility_published' }),
      );
    });

    it('requires confirmation before hiding a phase with started or completed matches', async () => {
      const phaseChain = makeChain({ data: null, error: null });
      phaseChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-1',
          type: 'single_elim',
          visibility_status: 'published',
          tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
        },
        error: null,
      });
      const matchesChain = makeAwaitableChain({
        data: [
          { id: 'match-1', status: 'running' },
          { id: 'match-2', status: 'completed' },
        ],
        error: null,
      });

      fromMock.mockReturnValueOnce(phaseChain).mockReturnValueOnce(matchesChain);

      await expect(
        service.updateVisibility('phase-1', 'actor-1', { visibility: 'hidden' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          requiresConfirmation: true,
          startedMatchCount: 1,
          completedMatchCount: 1,
        }),
      });
    });
  });
});
