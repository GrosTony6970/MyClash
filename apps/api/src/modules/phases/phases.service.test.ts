import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';
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
    not: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
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
  chain.not.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
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
    not: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  // All builder methods return the chain (Promise) itself
  for (const key of ['select', 'eq', 'in', 'not', 'limit', 'order', 'insert', 'update', 'delete']) {
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

    it('creates empty pools when there are zero registrations (operator pre-stages the layout)', async () => {
      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: [], error: null });
      const tournamentChain = makeChain({ data: { weapon: null }, error: null });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'new-phase' }, error: null });
      const poolInsertChain = makeChain({ data: null, error: null });
      poolInsertChain.single.mockResolvedValue({ data: { id: 'pool-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(poolInsertChain);

      const result = await service.generatePools('tournament-1', { poolCount: 3 }, false);
      expect(result.poolCount).toBe(3);
      expect(result.totalMatches).toBe(0);
      // pool_members.insert must NOT be called with [] (used to surface as 500).
      // We can't directly assert "never called with []" across this loose mock,
      // but the totalMatches=0 + lack of throw is the behavioural contract.
    });
  });

  // ── Pool lifecycle — delete one / delete all / add empty ──────────────────

  describe('pool lifecycle', () => {
    it('addEmptyPool stands up a new phase + one pool when none exists', async () => {
      const lookupPhase = makeChain({ data: null, error: null });
      lookupPhase.maybeSingle.mockResolvedValue({ data: null, error: null });
      const tournamentLookup = makeChain({
        data: { events: { organization_id: 'org-1' } },
        error: null,
      });
      const phaseInsert = makeChain({ data: null, error: null });
      phaseInsert.single.mockResolvedValue({ data: { id: 'new-phase' }, error: null });
      const existingPools = makeAwaitableChain({ data: [], error: null });
      const poolInsert = makeChain({ data: null, error: null });
      poolInsert.single.mockResolvedValue({
        data: { id: 'pool-1', name: 'Pool 1', sort_order: 0 },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(tournamentLookup)
        .mockReturnValueOnce(lookupPhase)
        .mockReturnValueOnce(phaseInsert)
        .mockReturnValueOnce(existingPools)
        .mockReturnValueOnce(poolInsert);

      const result = await service.addEmptyPool('tournament-1', 'user-1');
      expect(result).toMatchObject({ id: 'pool-1', name: 'Pool 1', sortOrder: 0 });
    });

    it('deleteAllPools is a no-op when there is no pool phase', async () => {
      const lookupPhase = makeChain({ data: null, error: null });
      lookupPhase.maybeSingle.mockResolvedValue({ data: null, error: null });

      fromMock.mockReturnValueOnce(lookupPhase);

      // Should resolve without throwing or making destructive calls.
      await expect(service.deleteAllPools('tournament-1', 'user-1')).resolves.toBeUndefined();
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

    it('throws BadRequestException when generated bracket would exceed 128 slots', async () => {
      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const seededRegsChain = makeAwaitableChain({ data: [], error: null });

      fromMock.mockReturnValueOnce(phaseCheckChain).mockReturnValueOnce(seededRegsChain);

      await expect(
        service.generateBracket('tournament-1', { qualifyCount: 256 }, false),
      ).rejects.toThrow(BadRequestException);
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

      // Trailing reads from the post-write getTournamentBracket() delegation.
      // generateBracket now reads back the canonical shape so the response
      // matches what GET /tournaments/:id/bracket returns.
      const phaseReadChain = makeChain({ data: null, error: null });
      phaseReadChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-new',
          type: 'single_elim',
          visibility_status: 'hidden',
          config_json: {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            byeSeedCount: 0,
            playInMatchCount: 0,
            hasPlayInRound: false,
            rounds: 3,
          },
        },
        error: null,
      });
      const slotsReadChain = makeAwaitableChain({
        data: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, round: 0, position: i })),
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(defaultChain) // bracket_slots insert — no-op
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain) // delegation read 2
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket('tournament-1', {}, false);
      expect(phaseInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility_status: 'hidden' }),
      );
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { rounds: number }).rounds).toBe(3);
      expect((result as { byeCount: number }).byeCount).toBe(0);
      expect((result as { totalSlots: number }).totalSlots).toBe(8); // 4+2+1+bronze
      // New: the response now exposes the `slots` array the client renders.
      expect((result as { slots: unknown[] }).slots).toHaveLength(8);
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

      const phaseReadChain = makeChain({ data: null, error: null });
      phaseReadChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-new',
          type: 'single_elim',
          visibility_status: 'hidden',
          config_json: {
            bracketSize: 8,
            fighterCount: 6,
            byeCount: 2,
            byeSeedCount: 2,
            playInMatchCount: 0,
            hasPlayInRound: false,
            rounds: 3,
          },
        },
        error: null,
      });
      const slotsReadChain = makeAwaitableChain({
        data: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, round: 0, position: i })),
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(defaultChain) // bracket_slots insert — no-op
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain) // delegation read 2
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket('tournament-1', { bracketSize: 8 }, false);
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { byeCount: number }).byeCount).toBe(2); // 8-6=2 byes
    });

    it('persists play-in metadata and creates initial scheduled matches', async () => {
      const regs = Array.from({ length: 18 }, (_, i) => ({
        id: `r${i + 1}`,
        seed: i + 1,
        bib_number: null,
      }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const seededRegsChain = makeAwaitableChain({ data: regs, error: null });

      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });

      const bracketSlotInsertChain = makeAwaitableChain({
        data: [
          {
            id: 'slot-playin-1',
            phase_id: 'phase-new',
            round: 0,
            position: 1,
            source_b_type: 'seed',
            registration_a_id: 'r15',
            registration_b_id: 'r18',
          },
          {
            id: 'slot-playin-2',
            phase_id: 'phase-new',
            round: 0,
            position: 2,
            source_b_type: 'seed',
            registration_a_id: 'r16',
            registration_b_id: 'r17',
          },
        ],
        error: null,
      });
      const matchInsertChain = makeChain({ data: null, error: null });

      // Trailing reads from the post-write getTournamentBracket() delegation.
      const phaseReadChain = makeChain({ data: null, error: null });
      phaseReadChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-new',
          type: 'single_elim',
          visibility_status: 'hidden',
          config_json: {
            bracketSize: 16,
            mainBracketSize: 16,
            fighterCount: 18,
            byeCount: 14,
            byeSeedCount: 14,
            playInMatchCount: 2,
            hasPlayInRound: true,
            rounds: 4,
          },
        },
        error: null,
      });
      const slotsReadChain = makeAwaitableChain({
        data: Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, round: 0, position: i })),
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(bracketSlotInsertChain)
        .mockReturnValueOnce(matchInsertChain)
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain); // delegation read 2

      const result = await service.generateBracket('tournament-1', { qualifyCount: 18 }, false);

      expect(phaseInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          config_json: expect.objectContaining({
            bracketSize: 16,
            mainBracketSize: 16,
            fighterCount: 18,
            byeCount: 14,
            byeSeedCount: 14,
            playInMatchCount: 2,
            hasPlayInRound: true,
          }),
        }),
      );
      expect(bracketSlotInsertChain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            round: 0,
            position: 1,
            registration_a_id: 'r15',
            registration_b_id: 'r18',
          }),
          expect.objectContaining({
            round: 1,
            source_b_ref: 'winner of R0P1',
          }),
          expect.objectContaining({
            round: 1,
            source_b_ref: 'winner of R0P2',
          }),
        ]),
      );
      expect(matchInsertChain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            phase_id: 'phase-new',
            bracket_slot_id: 'slot-playin-1',
            red_registration_id: 'r15',
            blue_registration_id: 'r18',
            status: 'scheduled',
          }),
          expect.objectContaining({
            phase_id: 'phase-new',
            bracket_slot_id: 'slot-playin-2',
            red_registration_id: 'r16',
            blue_registration_id: 'r17',
            status: 'scheduled',
          }),
        ]),
      );
      expect(result).toMatchObject({
        bracketSize: 16,
        byeCount: 14,
        playInMatchCount: 2,
      });
    });

    it('throws 501 NotImplementedException for unimplemented seeding strategies', async () => {
      // The 501 throws before any Supabase call, so no mocks are needed —
      // and crucially, no mockReturnValueOnce must be queued or it would
      // leak into subsequent tests.
      await expect(
        service.generateBracket('tournament-1', { seedingStrategy: 'by-rating' }, false),
      ).rejects.toThrow(NotImplementedException);
      await expect(
        service.generateBracket('tournament-1', { seedingStrategy: 'random' }, false),
      ).rejects.toThrow(NotImplementedException);
      await expect(
        service.generateBracket('tournament-1', { seedingStrategy: 'by-pool-rank' }, false),
      ).rejects.toThrow(NotImplementedException);
    });

    it('persists seedingStrategy and grandFinalReset into phases.config_json', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
      const seededRegsChain = makeAwaitableChain({
        data: eightRegs.map((reg, idx) => ({ ...reg, seed: idx + 1, bib_number: null })),
        error: null,
      });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });
      const defaultChain = makeChain({ data: null, error: null });
      const phaseReadChain = makeChain({ data: null, error: null });
      phaseReadChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-new',
          type: 'double_elim',
          visibility_status: 'hidden',
          config_json: {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            grandFinalReset: true,
            seedingStrategy: 'snake',
          },
        },
        error: null,
      });
      const slotsReadChain = makeAwaitableChain({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(defaultChain) // bracket_slots insert
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain) // delegation read 2
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket(
        'tournament-1',
        { phaseType: 'double_elim', grandFinalReset: true },
        false,
      );

      expect(phaseInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          config_json: expect.objectContaining({
            grandFinalReset: true,
            seedingStrategy: 'snake',
          }),
        }),
      );
      expect((result as { grandFinalReset: boolean }).grandFinalReset).toBe(true);
      expect((result as { seedingStrategy: string }).seedingStrategy).toBe('snake');
    });

    it('captures bronzeSlotId on single-elim and exposes it on the bracket read', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
      const seededRegsChain = makeAwaitableChain({
        data: eightRegs.map((reg, idx) => ({ ...reg, seed: idx + 1, bib_number: null })),
        error: null,
      });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });

      // Bracket slot insert returns the bronze slot (source_a_type='loser_of').
      const slotInsertChain = makeAwaitableChain({
        data: [
          {
            id: 'slot-r1-1',
            phase_id: 'phase-new',
            round: 1,
            position: 1,
            source_a_type: 'seed',
            source_b_type: 'seed',
            registration_a_id: 'r0',
            registration_b_id: 'r7',
          },
          {
            id: 'slot-bronze',
            phase_id: 'phase-new',
            round: 3,
            position: 2,
            source_a_type: 'loser_of',
            source_b_type: 'loser_of',
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });

      const phaseUpdateChain = makeChain({ data: null, error: null });
      const matchInsertChain = makeChain({ data: null, error: null });

      const phaseReadChain = makeChain({ data: null, error: null });
      phaseReadChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-new',
          type: 'single_elim',
          visibility_status: 'hidden',
          config_json: {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            rounds: 3,
            seedingStrategy: 'snake',
            bronzeSlotId: 'slot-bronze',
          },
        },
        error: null,
      });
      const slotsReadChain = makeAwaitableChain({
        data: [
          { id: 'slot-r1-1', round: 1, position: 1 },
          { id: 'slot-bronze', round: 3, position: 2 },
        ],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(seededRegsChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(slotInsertChain) // bracket_slots insert returns rows
        .mockReturnValueOnce(phaseUpdateChain) // phases update (bronzeSlotId)
        .mockReturnValueOnce(matchInsertChain) // initial matches insert
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain); // delegation read 2

      const result = await service.generateBracket('tournament-1', {}, false);

      expect(phaseUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          config_json: expect.objectContaining({ bronzeSlotId: 'slot-bronze' }),
        }),
      );
      expect((result as { bronzeSlotId: string | null }).bronzeSlotId).toBe('slot-bronze');
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

  describe('editBracketConfig', () => {
    function bracketPhase(type: 'single_elim' | 'double_elim' = 'double_elim') {
      const phaseChain = makeChain({ data: null, error: null });
      phaseChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-1',
          type,
          tournament_id: 'tournament-1',
          visibility_status: 'hidden',
          tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
        },
        error: null,
      });
      return phaseChain;
    }

    it('persists grandFinalReset to config_json when no matches have completed', async () => {
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: { bracketSize: 8, grandFinalReset: false } },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'phase-1', config_json: { grandFinalReset: true } },
        error: null,
      });
      const auditChain = makeChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseChain) // getPhaseForVisibility
        .mockReturnValueOnce(configReadChain) // config_json read
        .mockReturnValueOnce(completedCheckChain) // completed matches
        .mockReturnValueOnce(updateChain) // phases update
        .mockReturnValueOnce(auditChain); // audit log

      const result = await service.editBracketConfig('phase-1', 'actor-1', {
        grandFinalReset: true,
      });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          config_json: expect.objectContaining({ grandFinalReset: true }),
        }),
      );
      expect(result).toMatchObject({ id: 'phase-1' });
    });

    it('refuses the edit when at least one match has completed', async () => {
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: {} },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({
        data: [{ id: 'match-final' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain);

      await expect(
        service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects grandFinalReset edits on single-elim brackets', async () => {
      const phaseChain = bracketPhase('single_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: {} },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain);

      await expect(
        service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reseedBracketRoundOne', () => {
    it('throws 501 for unimplemented strategies', async () => {
      await expect(
        service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-rating' }),
      ).rejects.toThrow(NotImplementedException);
    });

    it('refuses when any R1 match has started', async () => {
      const phaseChain = makeChain({ data: null, error: null });
      phaseChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'phase-1',
          type: 'single_elim',
          tournament_id: 'tournament-1',
          visibility_status: 'hidden',
          tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
        },
        error: null,
      });
      const r1SlotsChain = makeAwaitableChain({
        data: [
          { id: 'slot-1', round: 1, position: 1, registration_a_id: 'r1', registration_b_id: 'r8' },
        ],
        error: null,
      });
      const blockingMatchesChain = makeAwaitableChain({
        data: [{ id: 'match-running', bracket_slot_id: 'slot-1', status: 'running' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(r1SlotsChain)
        .mockReturnValueOnce(blockingMatchesChain);

      await expect(
        service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'snake' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          blockingMatchIds: ['match-running'],
        }),
      });
    });
  });

  // ── deleteBracketPhase ───────────────────────────────────────────────────

  describe('deleteBracketPhase', () => {
    const bracketPhaseRow = {
      id: 'phase-1',
      tournament_id: 't1',
      type: 'single_elim',
      visibility_status: 'hidden',
      tournaments: { event_id: 'evt-1', events: { organization_id: 'org-1' } },
    };

    it('deletes the phase row and clears scoped referee assignments', async () => {
      const phaseLookup = makeChain({ data: bracketPhaseRow, error: null });
      phaseLookup.maybeSingle.mockResolvedValue({ data: bracketPhaseRow, error: null });

      const matchesLookup = makeAwaitableChain({
        data: [{ id: 'match-a' }, { id: 'match-b' }],
        error: null,
      });
      const refDelete = makeAwaitableChain({ data: null, error: null });
      const phaseDelete = makeAwaitableChain({ data: null, error: null });
      const auditInsert = makeAwaitableChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseLookup) // getPhaseForVisibility
        .mockReturnValueOnce(matchesLookup) // matches.select where phase_id
        .mockReturnValueOnce(refDelete) // referee_assignments.delete .in match_id
        .mockReturnValueOnce(phaseDelete) // phases.delete .eq id
        .mockReturnValueOnce(auditInsert); // audit_log.insert

      await service.deleteBracketPhase('phase-1', 'actor-1');

      expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'actor-1', 'admin');
      expect(refDelete.delete).toHaveBeenCalled();
      expect(refDelete.in).toHaveBeenCalledWith('match_id', ['match-a', 'match-b']);
      expect(phaseDelete.delete).toHaveBeenCalled();
      expect(phaseDelete.eq).toHaveBeenCalledWith('id', 'phase-1');
    });

    it('skips the referee_assignments delete when the phase has no matches', async () => {
      const phaseLookup = makeChain({ data: bracketPhaseRow, error: null });
      phaseLookup.maybeSingle.mockResolvedValue({ data: bracketPhaseRow, error: null });

      const matchesLookup = makeAwaitableChain({ data: [], error: null });
      const phaseDelete = makeAwaitableChain({ data: null, error: null });
      const auditInsert = makeAwaitableChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(phaseLookup)
        .mockReturnValueOnce(matchesLookup)
        .mockReturnValueOnce(phaseDelete) // straight to phases.delete — no referee_assignments call
        .mockReturnValueOnce(auditInsert);

      await service.deleteBracketPhase('phase-1', 'actor-1');

      expect(phaseDelete.delete).toHaveBeenCalled();
    });

    it('rejects pool-type phases with a steering message', async () => {
      const poolPhaseRow = {
        id: 'phase-pool',
        tournament_id: 't1',
        type: 'pool',
        visibility_status: 'hidden',
        tournaments: { event_id: 'evt-1', events: { organization_id: 'org-1' } },
      };
      const phaseLookup = makeChain({ data: poolPhaseRow, error: null });
      phaseLookup.maybeSingle.mockResolvedValue({ data: poolPhaseRow, error: null });
      fromMock.mockReturnValueOnce(phaseLookup);

      await expect(service.deleteBracketPhase('phase-pool', 'actor-1')).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('pool phases'),
      });
    });

    it('propagates ForbiddenException when actor lacks admin role', async () => {
      const phaseLookup = makeChain({ data: bracketPhaseRow, error: null });
      phaseLookup.maybeSingle.mockResolvedValue({ data: bracketPhaseRow, error: null });
      fromMock.mockReturnValueOnce(phaseLookup);

      mockOrgs.assertOrgRole.mockRejectedValueOnce(new Error('Requires admin role or higher'));

      await expect(service.deleteBracketPhase('phase-1', 'actor-low-priv')).rejects.toThrow(
        /admin role/,
      );
    });
  });

  describe('createInitialBracketMatches', () => {
    // Bracket matches must carry `match_number_label` (just the slot
    // position, stringified) so consumers downstream resolve the same
    // canonical round code the bracket view shows. Without this stamp,
    // the scoreboard fell through to "B{round}" — divergent from the
    // bracket card label.
    it('stamps match_number_label = String(slot.position) on every inserted row', async () => {
      let inserted: Array<Record<string, unknown>> | null = null;
      const insertChain = makeAwaitableChain({ data: null, error: null });
      insertChain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
        inserted = rows;
        return Promise.resolve({ data: null, error: null });
      }) as never;
      fromMock.mockReturnValueOnce(insertChain);

      const slots = [
        {
          id: 'slot-1',
          phase_id: 'phase-1',
          round: 1,
          position: 1,
          source_b_type: 'seed',
          registration_a_id: 'reg-a1',
          registration_b_id: 'reg-b1',
        },
        {
          id: 'slot-2',
          phase_id: 'phase-1',
          round: 1,
          position: 2,
          source_b_type: 'seed',
          registration_a_id: 'reg-a2',
          registration_b_id: 'reg-b2',
        },
      ];

      // createInitialBracketMatches is private; reach in via the index
      // type to test it in isolation without orchestrating a full
      // generateBracket fixture.
      await (service as unknown as Record<string, (s: unknown) => Promise<void>>)[
        'createInitialBracketMatches'
      ]!(slots);

      expect(inserted).toEqual([
        expect.objectContaining({
          bracket_slot_id: 'slot-1',
          match_number_label: '1',
        }),
        expect.objectContaining({
          bracket_slot_id: 'slot-2',
          match_number_label: '2',
        }),
      ]);
    });
  });

  describe('listPoolsWithMatches', () => {
    // Slice B of the canonical-round-code spec: the pool list and the
    // scoreboard previously rendered the same match under two different
    // identifiers because the pool tab built the code client-side.
    // `listPoolsWithMatches` must now ship a pre-built `roundCode` so the
    // FE renders it verbatim — same shape as `getMatchSummary`.
    it("returns a backend-built roundCode on each match (e.g. 'LSW-P1-ML1-PA-M1')", async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const chain = makeChain({ data: { weapon: 'longsword' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { weapon: 'longsword' }, error: null });
          chain.single.mockResolvedValue({ data: { weapon: 'longsword' }, error: null });
          return chain;
        }
        if (tableName === 'pools') {
          const chain = makeChain({ data: null, error: null });
          chain.order.mockResolvedValue({
            data: [{ id: 'pool-1', name: 'Pool A', sort_order: 0 }],
            error: null,
          });
          return chain;
        }
        if (tableName === 'vw_tournament_query_matches') {
          const chain = makeChain({ data: null, error: null });
          chain.order.mockResolvedValue({
            data: [
              {
                match_id: 'm-1',
                pool_id: 'pool-1',
                lice_id: null,
                lice_name: null,
                lice_number: null,
                red_registration_id: 'r-1',
                blue_registration_id: 'r-2',
                red_name: 'Red',
                blue_name: 'Blue',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M1',
              },
            ],
            error: null,
          });
          return chain;
        }
        if (tableName === 'matches') {
          const chain = makeChain({ data: [], error: null });
          chain.eq.mockResolvedValue({ data: [], error: null });
          return chain;
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');

      expect(result).toHaveLength(1);
      expect(result[0]?.matches).toHaveLength(1);
      expect((result[0]?.matches[0] as { roundCode: string }).roundCode).toBe('LSW-P1-ML1-PA-M1');
    });

    // Slice E of the per-role-referee spec: each match exposes a
    // `referees[]` array (one entry per scope_type='match' row in
    // `referee_assignments`) so the FE renders one column per role
    // with the referee's NAME instead of a single column of UUIDs.
    it('includes a referees[] array per match with role + refereeId + refereeName', async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const chain = makeChain({ data: { weapon: 'longsword' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { weapon: 'longsword' }, error: null });
          return chain;
        }
        if (tableName === 'pools') {
          const chain = makeChain({ data: null, error: null });
          chain.order.mockResolvedValue({
            data: [{ id: 'pool-1', name: 'Pool A', sort_order: 0 }],
            error: null,
          });
          return chain;
        }
        if (tableName === 'vw_tournament_query_matches') {
          const chain = makeChain({ data: null, error: null });
          chain.order.mockResolvedValue({
            data: [
              {
                match_id: 'm-1',
                pool_id: 'pool-1',
                lice_id: null,
                lice_name: null,
                lice_number: null,
                red_registration_id: 'r-1',
                blue_registration_id: 'r-2',
                red_name: 'Red',
                blue_name: 'Blue',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M1',
              },
            ],
            error: null,
          });
          return chain;
        }
        if (tableName === 'matches') {
          const chain = makeChain({ data: [], error: null });
          chain.eq.mockResolvedValue({ data: [], error: null });
          return chain;
        }
        if (tableName === 'referee_assignments') {
          // Per-match assignments. The service joins persons for the
          // display name; mock the embedded shape Supabase returns.
          const chain = makeChain({ data: null, error: null });
          chain.eq.mockResolvedValue({
            data: [
              {
                match_id: 'm-1',
                role: 'arbitre_declarant',
                person_id: 'person-1',
                persons: { display_name: 'Alice', given_name: 'Alice', family_name: 'Smith' },
              },
              {
                match_id: 'm-1',
                role: 'arbitre_assesseur',
                person_id: 'person-2',
                persons: { display_name: null, given_name: 'Bob', family_name: 'Jones' },
              },
            ],
            error: null,
          });
          return chain;
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');

      const match = result[0]!.matches[0] as {
        referees: Array<{ role: string; refereeId: string; refereeName: string }>;
      };
      expect(match.referees).toEqual(
        expect.arrayContaining([
          { role: 'arbitre_declarant', refereeId: 'person-1', refereeName: 'Alice' },
          { role: 'arbitre_assesseur', refereeId: 'person-2', refereeName: 'Bob Jones' },
        ]),
      );
    });
  });

  describe('listMatchScores', () => {
    // Lightweight endpoint for the pools-matches "surgical poll" path —
    // returns only the fields the FE needs to merge a score update in
    // place (no referee assignments, no derived labels). Lock the
    // shape so we don't accidentally leak privileged data through
    // a cheap polling endpoint.
    it("returns only (id, status, red_score, blue_score) for a tournament's matches", async () => {
      const matchesChain = makeChain({
        data: [
          { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
          { id: 'm-2', status: 'pending', red_score: null, blue_score: null },
        ],
        error: null,
      });
      // The chain resolves when awaited after `.eq(...)`; mirror the
      // pattern used by listPoolsWithMatches's data selects.
      matchesChain.eq.mockResolvedValue({
        data: [
          { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
          { id: 'm-2', status: 'pending', red_score: null, blue_score: null },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(matchesChain);

      const result = await service.listMatchScores('tournament-1');

      expect(result).toEqual([
        { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
        { id: 'm-2', status: 'pending', red_score: null, blue_score: null },
      ]);
      // The SELECT must NOT include privileged fields like referee_id
      // or lice_id — those should only come through the heavier
      // `pools-with-matches` endpoint that handles permissions properly.
      expect(matchesChain.select).toHaveBeenCalledWith('id, status, red_score, blue_score');
      expect(matchesChain.eq).toHaveBeenCalledWith('tournament_id', 'tournament-1');
    });
  });
});
