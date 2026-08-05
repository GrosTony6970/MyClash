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

    it('caps poolCount so no pool is forced to be a singleton (5 fighters, targetSize=2 → 2 pools)', async () => {
      // Prod 500 repro: with targetSize=2 and an odd fighterCount, the old
      // Math.ceil math produced poolCount=3 and snakeSeed left one pool with
      // a single fighter — bergerSchedule(1) then threw and the request
      // crashed inside the NestJS handler. After the cap, poolCount=2 and
      // the distribution is [3, 2].
      const fiveRegs = Array.from({ length: 5 }, (_, i) => ({
        id: `r${i + 1}`,
        seed: i + 1,
        bib_number: null,
        persons: { club_id: null },
      }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: fiveRegs, error: null });
      const tournamentChain = makeChain({ data: { weapon: null }, error: null });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'new-phase' }, error: null });
      const defaultChain = makeChain({ data: null, error: null });
      defaultChain.single.mockResolvedValue({ data: { id: 'pool-x' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(defaultChain);

      const result = await service.generatePools('tournament-1', { targetSize: 2 }, false);
      expect(result.poolCount).toBe(2);
    });

    it('does not throw when a pool ends up with a single fighter (defensive guard)', async () => {
      // Corner case: operator stands up a layout with a single registration
      // (e.g. preview before the rest of the roster lands). The pool gets
      // written + the lone pool_member gets inserted, but bergerSchedule is
      // skipped so we don't crash on n<2. totalMatches stays 0.
      const oneReg = [{ id: 'r1', seed: 1, bib_number: null, persons: { club_id: null } }];

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: oneReg, error: null });
      const tournamentChain = makeChain({ data: { weapon: null }, error: null });
      const phaseInsertChain = makeChain({ data: null, error: null });
      phaseInsertChain.single.mockResolvedValue({ data: { id: 'new-phase' }, error: null });
      const defaultChain = makeChain({ data: null, error: null });
      defaultChain.single.mockResolvedValue({ data: { id: 'pool-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseCheckChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValue(defaultChain);

      const result = await service.generatePools('tournament-1', { poolCount: 1 }, false);
      expect(result.poolCount).toBe(1);
      expect(result.totalMatches).toBe(0);
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

      fromMock.mockReturnValueOnce(phaseCheckChain);

      await expect(
        service.generateBracket('tournament-1', { qualifyCount: 256 }, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates bracket with correct structure for 8 fighters', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });

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
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(defaultChain) // bracket_slots insert — no-op
        .mockReturnValueOnce(phaseReadChain) // delegation read 1
        .mockReturnValueOnce(slotsReadChain) // delegation read 2
        .mockReturnValue(defaultChain);

      const result = await service.generateBracket('tournament-1', { bracketSize: 8 }, false);
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { byeCount: number }).byeCount).toBe(2); // 8-6=2 byes
    });

    it('persists play-in metadata in config_json and slot rows (matches are deferred to populate-bracket)', async () => {
      const regs = Array.from({ length: 18 }, (_, i) => ({
        id: `r${i + 1}`,
        seed: i + 1,
        bib_number: null,
      }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      void regs; // explicit qualifyCount in DTO; registrations fetch no longer happens

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
            registration_a_id: null,
            registration_b_id: null,
          },
          {
            id: 'slot-playin-2',
            phase_id: 'phase-new',
            round: 0,
            position: 2,
            source_b_type: 'seed',
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });
      // createInitialBracketMatches now pre-creates a matches row for
      // every non-bye slot, including play-in slots with null
      // registrations — so a matchInsertChain MUST be queued.
      // It first resolves the tournament's ruleset stamp (matchRulesetForPhase).
      const rulesetChain = makeChain({
        data: { tournaments: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0' } },
        error: null,
      });
      const matchInsertChain = makeAwaitableChain({ data: null, error: null });

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
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(bracketSlotInsertChain)
        .mockReturnValueOnce(rulesetChain) // matchRulesetForPhase (phases → tournaments)
        .mockReturnValueOnce(matchInsertChain) // pre-created bracket placeholder rows
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
          // R1 slots are now created EMPTY by generateBracket — populate-bracket
          // seeds them from pool standings (or registrations) after pools finish.
          expect.objectContaining({
            round: 0,
            position: 1,
            registration_a_id: null,
            registration_b_id: null,
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
      // No matches are inserted at generation now — populateBracket creates
      // them once R1 (and play-in) slots actually have registrations.
      expect(result).toMatchObject({
        bracketSize: 16,
        byeCount: 14,
        playInMatchCount: 2,
      });
    });

    it('accepts every seeding strategy and stamps it onto config_json', async () => {
      // generateBracket builds the STRUCTURE only — it must not resolve a rank
      // order, so a non-default strategy is stored verbatim and consumed later
      // by populateBracket. This replaces the old 501 guard.
      for (const strategy of ['by-rating', 'random', 'by-pool-rank'] as const) {
        fromMock.mockReset();
        const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));
        const phaseCheckChain = makeChain({ data: null, error: null });
        phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
        const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
        const phaseInsertChain = makeChain({ data: null, error: null });
        phaseInsertChain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });
        const defaultChain = makeChain({ data: null, error: null });
        const phaseReadChain = makeChain({ data: null, error: null });
        phaseReadChain.maybeSingle.mockResolvedValue({
          data: {
            id: 'phase-new',
            type: 'single_elim',
            visibility_status: 'hidden',
            config_json: { bracketSize: 8, seedingStrategy: strategy },
          },
          error: null,
        });
        const slotsReadChain = makeAwaitableChain({ data: [], error: null });

        fromMock
          .mockReturnValueOnce(phaseCheckChain)
          .mockReturnValueOnce(regsChain)
          .mockReturnValueOnce(phaseInsertChain)
          .mockReturnValueOnce(defaultChain)
          .mockReturnValueOnce(phaseReadChain)
          .mockReturnValueOnce(slotsReadChain)
          .mockReturnValue(defaultChain);

        const result = await service.generateBracket(
          'tournament-1',
          { seedingStrategy: strategy },
          false,
        );

        expect(phaseInsertChain.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            config_json: expect.objectContaining({ seedingStrategy: strategy }),
          }),
        );
        expect((result as { seedingStrategy: string }).seedingStrategy).toBe(strategy);
      }
    });

    it('persists seedingStrategy and grandFinalReset into phases.config_json', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
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

    /**
     * Table-name dispatch rather than ordered mockReturnValueOnce: this path
     * fans out to phases / bracket_slots / matches in an order that shifts
     * whenever a lookup is added, and an ordered queue silently desyncs.
     */
    it('generates a play-in round and leaves the conditional reset match uncreated', async () => {
      const twelveRegs = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}` }));
      const inserts: Record<string, unknown[]> = { bracket_slots: [], matches: [] };
      let slotRows: Array<Record<string, unknown>> = [];

      fromMock.mockImplementation((table: string) => {
        if (table === 'registrations') return makeAwaitableChain({ data: twelveRegs, error: null });
        if (table === 'bracket_slots') {
          const chain = makeAwaitableChain({ data: slotRows, error: null });
          chain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
            inserts['bracket_slots']!.push(...rows);
            // Echo the rows back with ids, the way PostgREST's insert().select() does.
            slotRows = rows.map((r, i) => ({ ...r, id: `slot-${i}` }));
            return makeAwaitableChain({ data: slotRows, error: null });
          }) as never;
          return chain;
        }
        if (table === 'matches') {
          const chain = makeAwaitableChain({ data: [], error: null });
          chain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
            inserts['matches']!.push(...rows);
            return makeAwaitableChain({ data: rows, error: null });
          }) as never;
          return chain;
        }
        // phases: the existence check must miss, later reads return the phase.
        const chain = makeChain({ data: null, error: null });
        chain.single.mockResolvedValue({ data: { id: 'phase-new' }, error: null });
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        return chain;
      });

      await service.generateBracket(
        'tournament-1',
        { phaseType: 'double_elim', grandFinalReset: true },
        false,
      );

      const slots = inserts['bracket_slots'] as Array<{ round: number; source_a_ref: string }>;
      // 12 fighters trim to an 8-bracket, so 4 play-in matches sit at round 0.
      expect(slots.filter((s) => s.round === 0).length).toBe(4);
      // No byes: a bye has no loser, and the losers bracket feeds off WB losers.
      expect(slots.some((s) => s.source_a_ref === 'bye')).toBe(false);

      // wbRounds=3, lbRounds=4 → GF is round 8 and the reset round 9. The reset
      // is only PLAYED when the losers-bracket entrant wins the grand final, so
      // it must not get a placeholder match at generation time.
      const resetSlotIds = slotRows.filter((r) => r['round'] === 9).map((r) => r['id']);
      expect(resetSlotIds.length).toBe(1);
      const matchSlotIds = (inserts['matches'] as Array<{ bracket_slot_id: string }>).map(
        (m) => m.bracket_slot_id,
      );
      expect(matchSlotIds).not.toContain(resetSlotIds[0]);
      // Every other slot does get one.
      expect(matchSlotIds.length).toBe(slotRows.length - 1);
    });

    it('captures bronzeSlotId on single-elim and exposes it on the bracket read', async () => {
      const eightRegs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));

      const phaseCheckChain = makeChain({ data: null, error: null });
      phaseCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const regsChain = makeAwaitableChain({ data: eightRegs, error: null });
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
            registration_a_id: null,
            registration_b_id: null,
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
      const rulesetChain = makeChain({
        data: { tournaments: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0' } },
        error: null,
      });
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
        .mockReturnValueOnce(phaseInsertChain)
        .mockReturnValueOnce(slotInsertChain) // bracket_slots insert returns rows
        .mockReturnValueOnce(phaseUpdateChain) // phases update (bronzeSlotId)
        // createInitialBracketMatches now pre-creates a matches row for
        // every non-bye slot (R1, R2+, bronze), even when registrations
        // are still null — so the matches insert IS queued, preceded by
        // the matchRulesetForPhase lookup.
        .mockReturnValueOnce(rulesetChain)
        .mockReturnValueOnce(matchInsertChain)
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

    /**
     * The podium model and the repechage cutoff decide which slots EXIST, and
     * this endpoint writes config_json without touching bracket_slots. Applying
     * them here would leave a bracket whose stored shape contradicts its rows —
     * so they are refused with a pointer to regenerate instead.
     */
    it.each([
      ['secondChanceTarget', { secondChanceTarget: 'bronze' as const }],
      ['bronzeMatch', { secondChanceTarget: 'bronze' as const, bronzeMatch: false }],
      ['repechageEntrySize', { repechageEntrySize: 8 as const }],
    ])('refuses the in-place %s change and says to regenerate', async (_field, dto) => {
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: { bracketSize: 8, wbRounds: 3, lbRounds: 4 } },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain);

      await expect(service.editBracketConfig('phase-1', 'actor-1', dto)).rejects.toThrow(
        /Regenerate the bracket/,
      );
    });

    it('allows re-sending a structural value that is already stored', async () => {
      // Not a change, so not a rebuild — the form posts the whole podium struct.
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: { bracketSize: 8, secondChanceTarget: 'gold' } },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'phase-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await expect(
        service.editBracketConfig('phase-1', 'actor-1', {
          secondChanceTarget: 'gold',
          repechageEntrySize: null,
        }),
      ).resolves.toMatchObject({ id: 'phase-1' });
    });

    /**
     * Slice 1 made the reset slot conditional at GENERATION time but left this
     * endpoint writing config only — so turning the option on afterwards
     * flipped the flag without creating the slot it controls, and the bracket
     * had no reset to play.
     */
    it('creates the reset slot when the option is turned on after generation', async () => {
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: {
          config_json: {
            bracketSize: 8,
            fighterCount: 8,
            wbRounds: 3,
            lbRounds: 4,
            grandFinalReset: false,
          },
        },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });
      const slotLookupChain = makeAwaitableChain({ data: [], error: null });
      const slotInsertChain = makeAwaitableChain({ data: null, error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'phase-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain)
        .mockReturnValueOnce(slotLookupChain) // existing reset slot?
        .mockReturnValueOnce(slotInsertChain) // insert it
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: true });

      // Round 9 = wbRounds(3) + lbRounds(4) + 2, and the refs must match what
      // the generator emits or advancement silently stalls forever.
      expect(slotInsertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          round: 9,
          position: 1,
          source_a_ref: 'loser of GF',
          source_b_ref: 'winner of GF',
        }),
      );
    });

    it('drops the reset slot when the option is turned off', async () => {
      const phaseChain = bracketPhase('double_elim');
      const configReadChain = makeChain({ data: null, error: null });
      configReadChain.maybeSingle.mockResolvedValue({
        data: { config_json: { bracketSize: 8, wbRounds: 3, lbRounds: 4, grandFinalReset: true } },
        error: null,
      });
      const completedCheckChain = makeAwaitableChain({ data: [], error: null });
      const slotDeleteChain = makeAwaitableChain({ data: null, error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'phase-1' }, error: null });

      fromMock
        .mockReturnValueOnce(phaseChain)
        .mockReturnValueOnce(configReadChain)
        .mockReturnValueOnce(completedCheckChain)
        .mockReturnValueOnce(slotDeleteChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: false });

      expect(slotDeleteChain.delete).toHaveBeenCalled();
      expect(slotDeleteChain.eq).toHaveBeenCalledWith('round', 9);
    });
  });

  describe('reseedBracketRoundOne', () => {
    /**
     * Name-dispatched `from` rather than an ordered mockReturnValueOnce queue:
     * matchRulesetForTournament issues its own lookups mid-flow, so any
     * position-based sequence desyncs the moment that helper changes.
     */
    function mockReseedTables(overrides: {
      phaseConfig?: Record<string, unknown>;
      registrations?: Array<{ id: string; seed: number | null; bib_number: number | null }>;
    }) {
      const phasesChain = makeChain({ data: null, error: null });
      phasesChain.maybeSingle
        .mockResolvedValueOnce({
          data: {
            id: 'phase-1',
            type: 'single_elim',
            tournament_id: 'tournament-1',
            visibility_status: 'hidden',
            tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { config_json: overrides.phaseConfig ?? {} },
          error: null,
        });

      const slotsChain = makeAwaitableChain({ data: [], error: null });
      const regsChain = makeAwaitableChain({
        data: overrides.registrations ?? [
          { id: 'r1', seed: 1, bib_number: null },
          { id: 'r2', seed: 2, bib_number: null },
        ],
        error: null,
      });
      const fallback = makeChain({ data: null, error: null });

      fromMock.mockImplementation((table: string) => {
        if (table === 'phases') return phasesChain;
        if (table === 'bracket_slots') return slotsChain;
        if (table === 'registrations') return regsChain;
        return fallback;
      });
      return { phasesChain, regsChain };
    }

    it('persists a reproducible PRNG seed for a random reseed', async () => {
      const { phasesChain } = mockReseedTables({});

      await service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'random' });

      const updateArg = phasesChain.update.mock.calls.at(-1)?.[0] as {
        config_json: Record<string, unknown>;
      };
      expect(updateArg.config_json['seedingStrategy']).toBe('random');
      // Without a stored seed the draw could never be replayed after a dispute.
      expect(typeof updateArg.config_json['seedingRandomSeed']).toBe('number');
    });

    it('reads registrations with the rating embed only for by-rating', async () => {
      const { regsChain } = mockReseedTables({});
      await service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-rating' });
      expect(regsChain.select).toHaveBeenCalledWith(
        'id, seed, bib_number, persons(global_persons(hema_ratings_id))',
      );

      vi.clearAllMocks();
      const plain = mockReseedTables({});
      await service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'snake' });
      expect(plain.regsChain.select).toHaveBeenCalledWith('id, seed, bib_number');
    });

    it('refuses by-pool-rank rather than silently falling back to registration seed', async () => {
      // This service instance has no PoolStandingsService, which stands in for
      // "no pool results to seed from". The whole point of the strategy is that
      // it fails loudly instead of degrading to seed order.
      mockReseedTables({});

      await expect(
        service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-pool-rank' }),
      ).rejects.toThrow(BadRequestException);
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

  describe('getTournamentBracket — enriched shape', () => {
    // Bug: manually overriding a slot persisted registration_a_id on
    // the row, but the projection only selected raw bracket_slots
    // columns. The frontend BracketSlotData interface expects
    // redFighterName, redScore, status, matchId etc. — so the slot
    // card always rendered the '-' placeholder regardless of writes.
    // The fix joins matches (by bracket_slot_id) and registrations
    // (by registration_a_id / registration_b_id) so the projection
    // returns the shape MatchCard actually consumes.

    function phaseChain() {
      return makeChain({
        data: {
          id: 'phase-1',
          type: 'single_elim',
          visibility_status: 'published',
          config_json: { bracketSize: 4, fighterCount: 4, rounds: 2 },
        },
        error: null,
      });
    }

    it('resolves redFighterName + redClubAbbrev from registration_a_id (tracer)', async () => {
      const slotsChain = makeAwaitableChain({
        data: [
          {
            id: 's-1',
            round: 0,
            position: 0,
            source_a_type: null,
            source_a_ref: null,
            source_b_type: null,
            source_b_ref: null,
            registration_a_id: 'reg-1',
            registration_b_id: null,
          },
        ],
        error: null,
      });
      const matchesChain = makeAwaitableChain({ data: [], error: null });
      const regsChain = makeAwaitableChain({
        data: [
          {
            id: 'reg-1',
            persons: {
              given_name: 'Alice',
              family_name: 'Smith',
              clubs: { name: 'Lyon AMHE' },
            },
          },
        ],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(matchesChain)
        .mockReturnValueOnce(regsChain);

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['redFighterName']).toBe('Alice Smith');
      expect(slot['redClubAbbrev']).toBe('Lyon AMHE');
    });

    it('carries status + red/blue scores + matchId from the linked match row', async () => {
      const slotsChain = makeAwaitableChain({
        data: [
          {
            id: 's-1',
            round: 0,
            position: 0,
            source_a_type: null,
            source_a_ref: null,
            source_b_type: null,
            source_b_ref: null,
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });
      const matchesChain = makeAwaitableChain({
        data: [
          {
            id: 'match-1',
            bracket_slot_id: 's-1',
            status: 'completed',
            red_score: 5,
            blue_score: 3,
          },
        ],
        error: null,
      });
      // regsChain is NOT queued because the slot has no
      // registration_a_id / registration_b_id; the impl skips the
      // registrations fetch entirely in that case.
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(matchesChain);

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['matchId']).toBe('match-1');
      expect(slot['status']).toBe('completed');
      expect(slot['redScore']).toBe(5);
      expect(slot['blueScore']).toBe(3);
    });

    it('surfaces liceId from the linked match row (drives bracket → ScoringPad redirect)', async () => {
      // Frontend uses slot.liceId to build the cross-app scoring URL.
      // Without this projection the bracket click would always have to
      // fall through to the audit page.
      const slotsChain = makeAwaitableChain({
        data: [
          {
            id: 's-1',
            round: 0,
            position: 0,
            source_a_type: null,
            source_a_ref: null,
            source_b_type: null,
            source_b_ref: null,
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });
      const matchesChain = makeAwaitableChain({
        data: [
          {
            id: 'match-1',
            bracket_slot_id: 's-1',
            status: 'ready',
            red_score: 0,
            blue_score: 0,
            lice_id: 'lice-42',
          },
        ],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(matchesChain);

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['liceId']).toBe('lice-42');
    });

    it("empty slot returns null-shaped fields (not undefined) so MatchCard renders '-'", async () => {
      const slotsChain = makeAwaitableChain({
        data: [
          {
            id: 's-1',
            round: 0,
            position: 0,
            source_a_type: null,
            source_a_ref: null,
            source_b_type: null,
            source_b_ref: null,
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });
      const matchesChain = makeAwaitableChain({ data: [], error: null });
      // regsChain skipped — see note in score test.
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(matchesChain);

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['redFighterName']).toBeNull();
      expect(slot['blueFighterName']).toBeNull();
      expect(slot['redScore']).toBeNull();
      expect(slot['blueScore']).toBeNull();
      expect(slot['matchId']).toBeNull();
      expect(slot['status']).toBe('scheduled');
    });

    // Bracket cards could not say WHERE a bout runs or WHO calls it: the slot
    // projection carried a bare `liceId` and nothing else, so MatchCard's lice
    // pill and referee band — both already written — never rendered anywhere.
    //
    // Dispatched by TABLE NAME rather than by a mockReturnValueOnce sequence:
    // this method now issues seven reads and an ordered chain re-breaks every
    // time one is added or moved.
    it('enriches slots with the piste name and the officiating crew', async () => {
      const byTable: Record<string, unknown> = {
        phases: makeChain({
          data: {
            id: 'phase-1',
            type: 'single_elim',
            visibility_status: 'published',
            config_json: { bracketSize: 4, fighterCount: 4, rounds: 2 },
          },
          error: null,
        }),
        bracket_slots: makeAwaitableChain({
          data: [
            {
              id: 's-1',
              round: 0,
              position: 0,
              source_a_type: null,
              source_a_ref: null,
              source_b_type: null,
              source_b_ref: null,
              registration_a_id: null,
              registration_b_id: null,
            },
          ],
          error: null,
        }),
        matches: makeAwaitableChain({
          data: [
            {
              id: 'match-1',
              bracket_slot_id: 's-1',
              status: 'ready',
              red_score: null,
              blue_score: null,
              lice_id: 'lice-2',
            },
          ],
          error: null,
        }),
        tournaments: makeChain({ data: { event_id: 'ev-1' }, error: null }),
        lices: makeAwaitableChain({
          data: [
            { id: 'lice-1', name: 'Lice 1' },
            { id: 'lice-2', name: 'Lice 2' },
          ],
          error: null,
        }),
        referee_assignments: makeAwaitableChain({
          data: [
            {
              scope_type: 'match',
              match_id: 'match-1',
              pool_id: null,
              lice_id: null,
              person_id: 'gp-1',
              role: 'arbitre_declarant',
              status: 'confirmed',
              global_persons: { given_name: 'Marc', family_name: 'Lefevre' },
            },
          ],
          error: null,
        }),
        referee_skills: makeAwaitableChain({
          data: [{ id: 'arbitre_declarant', name: 'Déclarant', color: 'orange' }],
          error: null,
        }),
      };
      fromMock.mockImplementation(
        (table: string) => byTable[table] ?? makeChain({ data: null, error: null }),
      );

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['liceName']).toBe('Lice 2');
      expect(slot['referees']).toEqual([
        {
          role: 'arbitre_declarant',
          roleLabel: 'Déclarant',
          displayName: 'Marc Lefevre',
          status: 'confirmed',
          skillColor: 'orange',
        },
      ]);
    });

    it('leaves an unplaced slot without a piste name and with no referees', async () => {
      const slotsChain = makeAwaitableChain({
        data: [
          {
            id: 's-1',
            round: 0,
            position: 0,
            source_a_type: null,
            source_a_ref: null,
            source_b_type: null,
            source_b_ref: null,
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));

      const result = await service.getTournamentBracket('tournament-1');
      const slot = result!.slots[0] as Record<string, unknown>;
      expect(slot['liceName']).toBeNull();
      expect(slot['referees']).toEqual([]);
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
      // matchRulesetForPhase (phases → tournaments) runs before the insert.
      const rulesetChain = makeChain({
        data: { tournaments: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0' } },
        error: null,
      });
      fromMock.mockReturnValueOnce(rulesetChain).mockReturnValueOnce(insertChain);

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

    // Pre-create placeholder match rows for every non-bye slot at
    // bracket-generation time — including R2+ rows whose registrations
    // resolve later. This is what lets the schedule grid render every
    // downstream slot as a draggable chip immediately after a bracket
    // is generated, so an operator can time-block the whole day before
    // any match has been played. Bye slots stay excluded (no match
    // played at a bye), and resolved-later sides carry null
    // registrations that get UPDATEd in by bracket-advance.
    it('inserts a row for every non-bye slot, including R2+ rows with null registrations', async () => {
      let inserted: Array<Record<string, unknown>> | null = null;
      const insertChain = makeAwaitableChain({ data: null, error: null });
      insertChain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
        inserted = rows;
        return Promise.resolve({ data: null, error: null });
      }) as never;
      // matchRulesetForPhase (phases → tournaments) runs before the insert.
      const rulesetChain = makeChain({
        data: { tournaments: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0' } },
        error: null,
      });
      fromMock.mockReturnValueOnce(rulesetChain).mockReturnValueOnce(insertChain);

      const slots = [
        // R1 played match — both fighters known
        {
          id: 'slot-r1p1',
          phase_id: 'phase-1',
          round: 1,
          position: 1,
          source_b_type: 'seed',
          registration_a_id: 'reg-a1',
          registration_b_id: 'reg-b1',
        },
        // R1 bye — no match is ever played here; must NOT get a row
        {
          id: 'slot-r1p2-bye',
          phase_id: 'phase-1',
          round: 1,
          position: 2,
          source_b_type: 'bye',
          registration_a_id: 'reg-a2',
          registration_b_id: null,
        },
        // R2 final — both sides resolve from upstream winners; null today,
        // but must STILL get a placeholder match row so it shows up in the
        // schedule grid pre-played.
        {
          id: 'slot-r2p1',
          phase_id: 'phase-1',
          round: 2,
          position: 1,
          source_b_type: 'winner',
          registration_a_id: null,
          registration_b_id: null,
        },
        // Bronze final — also resolves from upstream losers; same rule.
        {
          id: 'slot-bronze',
          phase_id: 'phase-1',
          round: 2,
          position: 2,
          source_b_type: 'loser',
          registration_a_id: null,
          registration_b_id: null,
        },
      ];

      await (service as unknown as Record<string, (s: unknown) => Promise<void>>)[
        'createInitialBracketMatches'
      ]!(slots);

      expect(inserted).toEqual([
        expect.objectContaining({
          bracket_slot_id: 'slot-r1p1',
          red_registration_id: 'reg-a1',
          blue_registration_id: 'reg-b1',
        }),
        expect.objectContaining({
          bracket_slot_id: 'slot-r2p1',
          red_registration_id: null,
          blue_registration_id: null,
        }),
        expect.objectContaining({
          bracket_slot_id: 'slot-bronze',
          red_registration_id: null,
          blue_registration_id: null,
        }),
      ]);
      // Bye slot must not appear.
      expect(
        (inserted as Array<Record<string, unknown>> | null)?.find(
          (row) => row['bracket_slot_id'] === 'slot-r1p2-bye',
        ),
      ).toBeUndefined();
    });
  });

  describe('listPoolsWithMatches', () => {
    // Slice B of the canonical-round-code spec: the pool list and the
    // scoreboard previously rendered the same match under two different
    // identifiers because the pool tab built the code client-side.
    // `listPoolsWithMatches` must now ship a pre-built `roundCode` so the
    // FE renders it verbatim — same shape as `getMatchSummary`.
    it("returns a backend-built roundCode on each match (e.g. 'LSW-P1-M1')", async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const tournamentRow = { event_id: 'event-1', weapon: 'longsword' };
          const chain = makeChain({ data: tournamentRow, error: null });
          chain.maybeSingle.mockResolvedValue({ data: tournamentRow, error: null });
          chain.single.mockResolvedValue({ data: tournamentRow, error: null });
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
      expect((result[0]?.matches[0] as { roundCode: string }).roundCode).toBe('LSW-P1-M1');
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
          const tournamentRow = { event_id: 'event-1', weapon: 'longsword' };
          const chain = makeChain({ data: tournamentRow, error: null });
          chain.maybeSingle.mockResolvedValue({ data: tournamentRow, error: null });
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
          // Per-match assignments. The service joins global_persons for
          // the display name (post-0063: referee_assignments.person_id
          // → global_persons.id). The fetch is now scoped by event_id
          // (via .eq) and scope_type (via .in), so the await resolves
          // at .in('scope_type', [...]).
          const chain = makeChain({ data: null, error: null });
          chain.in.mockResolvedValue({
            data: [
              {
                match_id: 'm-1',
                pool_id: null,
                role: 'arbitre_declarant',
                person_id: 'person-1',
                global_persons: {
                  display_name: 'Alice',
                  given_name: 'Alice',
                  family_name: 'Smith',
                },
              },
              {
                match_id: 'm-1',
                pool_id: null,
                role: 'arbitre_assesseur',
                person_id: 'person-2',
                global_persons: { display_name: null, given_name: 'Bob', family_name: 'Jones' },
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
          expect.objectContaining({
            role: 'arbitre_declarant',
            refereeId: 'person-1',
            refereeName: 'Alice',
          }),
          expect.objectContaining({
            role: 'arbitre_assesseur',
            refereeId: 'person-2',
            refereeName: 'Bob Jones',
          }),
        ]),
      );
    });

    // Pool-scope referee_assignments rows (written by the Referees →
    // Assignments tab) act as the default for every match in the pool.
    // The Matches tab read must surface them so the operator's
    // assignments don't appear lost.
    it('surfaces a pool-scope assignment as the default on every match in the pool', async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const tournamentRow = { event_id: 'event-1', weapon: 'longsword' };
          const chain = makeChain({ data: tournamentRow, error: null });
          chain.maybeSingle.mockResolvedValue({ data: tournamentRow, error: null });
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
                red_name: 'Red 1',
                blue_name: 'Blue 1',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M1',
              },
              {
                match_id: 'm-2',
                pool_id: 'pool-1',
                lice_id: null,
                lice_name: null,
                lice_number: null,
                red_registration_id: 'r-3',
                blue_registration_id: 'r-4',
                red_name: 'Red 2',
                blue_name: 'Blue 2',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M2',
              },
              {
                match_id: 'm-3',
                pool_id: 'pool-1',
                lice_id: null,
                lice_name: null,
                lice_number: null,
                red_registration_id: 'r-5',
                blue_registration_id: 'r-6',
                red_name: 'Red 3',
                blue_name: 'Blue 3',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M3',
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
          // Single pool-scope row — the Assignments tab's write shape:
          // scope_type='pool', pool_id=X, match_id=null.
          const chain = makeChain({ data: null, error: null });
          chain.in.mockResolvedValue({
            data: [
              {
                match_id: null,
                pool_id: 'pool-1',
                role: 'arbitre_declarant',
                person_id: 'person-7',
                global_persons: {
                  display_name: 'Joe Referee',
                  given_name: 'Joe',
                  family_name: 'Referee',
                },
              },
            ],
            error: null,
          });
          return chain;
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');

      const matches = result[0]!.matches as Array<{
        id: string;
        referees: Array<{ role: string; refereeId: string; refereeName: string }>;
      }>;
      expect(matches).toHaveLength(3);
      for (const m of matches) {
        expect(m.referees).toContainEqual(
          expect.objectContaining({
            role: 'arbitre_declarant',
            refereeId: 'person-7',
            refereeName: 'Joe Referee',
          }),
        );
      }
    });

    it('lets a per-match scope_type=match row override the pool default for that one match', async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const tournamentRow = { event_id: 'event-1', weapon: 'longsword' };
          const chain = makeChain({ data: tournamentRow, error: null });
          chain.maybeSingle.mockResolvedValue({ data: tournamentRow, error: null });
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
                red_name: 'Red 1',
                blue_name: 'Blue 1',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M1',
              },
              {
                match_id: 'm-2',
                pool_id: 'pool-1',
                lice_id: null,
                lice_name: null,
                lice_number: null,
                red_registration_id: 'r-3',
                blue_registration_id: 'r-4',
                red_name: 'Red 2',
                blue_name: 'Blue 2',
                red_club: null,
                blue_club: null,
                red_score: null,
                blue_score: null,
                status: 'pending',
                match_number_label: 'L1-PA-M2',
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
          const chain = makeChain({ data: null, error: null });
          chain.in.mockResolvedValue({
            data: [
              // Pool default — Joe is Déclarant for the whole pool
              {
                match_id: null,
                pool_id: 'pool-1',
                role: 'arbitre_declarant',
                person_id: 'person-7',
                global_persons: {
                  display_name: 'Joe Default',
                  given_name: 'Joe',
                  family_name: 'Default',
                },
              },
              // Per-match override — m-2 gets Lea as Déclarant instead
              {
                match_id: 'm-2',
                pool_id: null,
                role: 'arbitre_declarant',
                person_id: 'person-9',
                global_persons: {
                  display_name: 'Lea Override',
                  given_name: 'Lea',
                  family_name: 'Override',
                },
              },
            ],
            error: null,
          });
          return chain;
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');
      const matches = result[0]!.matches as Array<{
        id: string;
        referees: Array<{ role: string; refereeId: string; refereeName: string }>;
      }>;

      const m1 = matches.find((m) => m.id === 'm-1')!;
      const m2 = matches.find((m) => m.id === 'm-2')!;

      expect(m1.referees).toContainEqual(
        expect.objectContaining({
          role: 'arbitre_declarant',
          refereeId: 'person-7',
          refereeName: 'Joe Default',
        }),
      );
      expect(m2.referees).toContainEqual(
        expect.objectContaining({
          role: 'arbitre_declarant',
          refereeId: 'person-9',
          refereeName: 'Lea Override',
        }),
      );
      // The override replaces the role — should not see both at once.
      expect(m2.referees.filter((r) => r.role === 'arbitre_declarant')).toHaveLength(1);
    });

    // Pins the post-0063 embed name. The Drizzle FK on
    // referee_assignments.person_id lands on global_persons(id), NOT
    // on the per-event persons table — PostgREST will silently 400
    // any SELECT that uses the legacy `persons(...)` embed (the bug
    // this commit fixes). If a future migration renames the embed
    // again, this tracer pops up first.
    it('reads the referee display name from the global_persons embed (post-0063)', async () => {
      let refereeSelectCall = '';
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          const chain = makeChain({ data: { id: 'phase-1' }, error: null });
          chain.maybeSingle.mockResolvedValue({ data: { id: 'phase-1' }, error: null });
          return chain;
        }
        if (tableName === 'tournaments') {
          const tournamentRow = { event_id: 'event-1', weapon: 'longsword' };
          const chain = makeChain({ data: tournamentRow, error: null });
          chain.maybeSingle.mockResolvedValue({ data: tournamentRow, error: null });
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
          const chain = makeChain({ data: null, error: null });
          // Capture the select string so we can assert the embed name.
          chain.select = vi.fn((columns: string) => {
            refereeSelectCall = columns;
            return chain;
          });
          chain.in.mockResolvedValue({
            data: [
              {
                match_id: 'm-1',
                pool_id: null,
                role: 'arbitre_assesseur',
                person_id: 'gp-1',
                global_persons: {
                  display_name: null,
                  given_name: 'Joe',
                  family_name: 'Referee',
                },
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

      expect(refereeSelectCall).toContain('global_persons');
      expect(refereeSelectCall).not.toMatch(/(?:^|,\s*)persons\s*\(/);
      expect(match.referees).toContainEqual(
        expect.objectContaining({
          role: 'arbitre_assesseur',
          refereeId: 'gp-1',
          refereeName: 'Joe Referee',
        }),
      );
    });

    // The view select has always fetched lice_name/lice_number; the ViewMatch
    // type and the mapper dropped both, so every consumer that wanted to say
    // which piste a pool runs on had to fetch the lices list separately.
    it('projects the piste name onto each match and collects the pool’s distinct pistes', async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          return makeChain({ data: { id: 'phase-1' }, error: null });
        }
        if (tableName === 'tournaments') {
          return makeChain({ data: { event_id: 'event-1', weapon: 'longsword' }, error: null });
        }
        if (tableName === 'pools') {
          return makeAwaitableChain({
            data: [{ id: 'pool-1', name: 'Pool 1', sort_order: 0 }],
            error: null,
          });
        }
        if (tableName === 'vw_tournament_query_matches') {
          return makeAwaitableChain({
            data: [
              {
                match_id: 'm-1',
                pool_id: 'pool-1',
                lice_id: 'lice-1',
                lice_name: 'Lice 1',
                lice_number: 1,
                status: 'completed',
                match_number_label: 'M1',
              },
              {
                match_id: 'm-2',
                pool_id: 'pool-1',
                lice_id: 'lice-2',
                lice_name: 'Lice 2',
                lice_number: 2,
                status: 'scheduled',
                match_number_label: 'M2',
              },
              // Same piste as m-1 — must not appear twice in liceNames.
              {
                match_id: 'm-3',
                pool_id: 'pool-1',
                lice_id: 'lice-1',
                lice_name: 'Lice 1',
                lice_number: 1,
                status: 'scheduled',
                match_number_label: 'M3',
              },
            ],
            error: null,
          });
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');

      expect(result[0]!.liceNames).toEqual(['Lice 1', 'Lice 2']);
      const matches = result[0]!.matches as Array<{ lice_name: string; lice_number: number }>;
      expect(matches[0]).toMatchObject({ lice_name: 'Lice 1', lice_number: 1 });
      expect(matches[1]).toMatchObject({ lice_name: 'Lice 2', lice_number: 2 });
    });

    // "The referee in this pool" is the pool's crew, not whatever one match
    // happens to override — so the header projection reads scope_type='pool'
    // and never the per-match merge the rows carry.
    it('projects only pool-scope assignments onto the pool header, labelled and coloured', async () => {
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'phases') {
          return makeChain({ data: { id: 'phase-1' }, error: null });
        }
        if (tableName === 'tournaments') {
          return makeChain({ data: { event_id: 'event-1', weapon: 'longsword' }, error: null });
        }
        if (tableName === 'pools') {
          return makeAwaitableChain({
            data: [{ id: 'pool-1', name: 'Pool 1', sort_order: 0 }],
            error: null,
          });
        }
        if (tableName === 'vw_tournament_query_matches') {
          return makeAwaitableChain({
            data: [
              {
                match_id: 'm-1',
                pool_id: 'pool-1',
                lice_id: 'lice-1',
                lice_name: 'Lice 1',
                status: 'scheduled',
                match_number_label: 'M1',
              },
            ],
            error: null,
          });
        }
        if (tableName === 'referee_assignments') {
          return makeAwaitableChain({
            data: [
              {
                match_id: null,
                pool_id: 'pool-1',
                role: 'arbitre_declarant',
                person_id: 'gp-1',
                global_persons: { display_name: 'Pool Crew' },
              },
              {
                match_id: 'm-1',
                pool_id: null,
                role: 'arbitre_assesseur',
                person_id: 'gp-2',
                global_persons: { display_name: 'One-Off Override' },
              },
            ],
            error: null,
          });
        }
        if (tableName === 'referee_skills') {
          return makeAwaitableChain({
            data: [{ id: 'arbitre_declarant', name: 'Déclarant', color: 'orange' }],
            error: null,
          });
        }
        return makeChain({ data: null, error: null });
      });

      const result = await service.listPoolsWithMatches('tournament-1');

      expect(result[0]!.referees).toEqual([
        {
          role: 'arbitre_declarant',
          roleLabel: 'Déclarant',
          roleColor: 'orange',
          name: 'Pool Crew',
        },
      ]);
    });
  });

  describe('listMatchScores', () => {
    // Lightweight endpoint for the pools-matches "surgical poll" path —
    // returns only the fields the FE needs to merge a score update in
    // place (no referee assignments, no derived labels). Lock the
    // shape so we don't accidentally leak privileged data through
    // a cheap polling endpoint.
    it("returns only (id, status, red_score, blue_score) for a tournament's matches", async () => {
      // Rows carry the `phases` embed the query has to ask for, because there
      // is no matches.tournament_id — the embed is the ONLY way to filter by
      // tournament, and it must not reach the caller.
      const rows = [
        {
          id: 'm-1',
          status: 'completed',
          red_score: 5,
          blue_score: 3,
          phases: { tournament_id: 'tournament-1' },
        },
        {
          id: 'm-2',
          status: 'pending',
          red_score: null,
          blue_score: null,
          phases: { tournament_id: 'tournament-1' },
        },
      ];
      const matchesChain = makeChain({ data: rows, error: null });
      // The chain resolves when awaited after `.eq(...)`; mirror the
      // pattern used by listPoolsWithMatches's data selects.
      matchesChain.eq.mockResolvedValue({ data: rows, error: null });
      fromMock.mockReturnValueOnce(matchesChain);

      const result = await service.listMatchScores('tournament-1');

      expect(result).toEqual([
        { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
        { id: 'm-2', status: 'pending', red_score: null, blue_score: null },
      ]);
      // The SELECT must NOT include privileged fields like referee_id
      // or lice_id — those should only come through the heavier
      // `pools-with-matches` endpoint that handles permissions properly.
      expect(matchesChain.select).toHaveBeenCalledWith(
        'id, status, red_score, blue_score, phases!inner(tournament_id)',
      );
      // Filtered THROUGH the embed. `matches.tournament_id` does not exist, and
      // asking for it 400'd — which `if (error) return []` turned into an empty
      // score list on every poll.
      expect(matchesChain.eq).toHaveBeenCalledWith('phases.tournament_id', 'tournament-1');
    });
  });

  // ── setPoolLice — pool-wide assignment ──────────────────────────────────
  // The matches tab pool-header strip lets operators pick one Lice for the
  // whole pool. Backend update is a single UPDATE matches SET lice_id=$1
  // WHERE pool_id=$2, gated by the same auth as the per-match PATCH.
  describe('setPoolLice', () => {
    it('updates every match in the pool to the given liceId', async () => {
      // Pool context lookup (private getPoolContext): pools.select.maybeSingle
      const poolCtxChain = makeChain({
        data: {
          id: 'pool-1',
          name: 'A',
          phase_id: 'phase-1',
          sort_order: 0,
          phases: {
            id: 'phase-1',
            tournament_id: 'tournament-1',
            tournaments: {
              event_id: 'event-1',
              weapon: 'longsword',
              tournament_id: 'tournament-1',
              events: { organization_id: 'org-1' },
            },
          },
        },
        error: null,
      });
      // assertPoolEditable: matches.select.eq.in (no started matches)
      const editableChain = makeChain({ data: [], error: null });
      editableChain.in.mockResolvedValue({ data: [], error: null });
      // Bulk update: matches.update({lice_id}).eq('pool_id', poolId)
      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(poolCtxChain)
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.setPoolLice('pool-1', 'lice-1', 'user-1');

      expect(updateChain.update).toHaveBeenCalledWith({ lice_id: 'lice-1' });
      expect(updateChain.eq).toHaveBeenCalledWith('pool_id', 'pool-1');
      expect(result).toEqual({ poolId: 'pool-1', liceId: 'lice-1' });
    });

    it('clears the lice on every match when liceId is null', async () => {
      const poolCtxChain = makeChain({
        data: {
          id: 'pool-1',
          name: 'A',
          phase_id: 'phase-1',
          sort_order: 0,
          phases: {
            id: 'phase-1',
            tournament_id: 'tournament-1',
            tournaments: {
              event_id: 'event-1',
              weapon: 'longsword',
              tournament_id: 'tournament-1',
              events: { organization_id: 'org-1' },
            },
          },
        },
        error: null,
      });
      const editableChain = makeChain({ data: [], error: null });
      editableChain.in.mockResolvedValue({ data: [], error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(poolCtxChain)
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.setPoolLice('pool-1', null, 'user-1');

      expect(updateChain.update).toHaveBeenCalledWith({ lice_id: null });
      expect(result).toEqual({ poolId: 'pool-1', liceId: null });
    });
  });

  // ── setPoolRefereeRoleAssignment — pool-wide per-role assignment ───────
  describe('setPoolRefereeRoleAssignment', () => {
    function makeAwaitableDeleteChain(result: unknown = { data: null, error: null }) {
      const promise = Promise.resolve(result);
      const chain = Object.assign(promise, {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        delete: vi.fn(),
        insert: vi.fn().mockResolvedValue(result),
        order: vi.fn(),
        update: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
      });
      for (const key of ['select', 'eq', 'in', 'delete', 'order', 'update']) {
        (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
      }
      return chain;
    }

    function poolContextChain() {
      return makeChain({
        data: {
          id: 'pool-1',
          name: 'A',
          phase_id: 'phase-1',
          sort_order: 0,
          phases: {
            id: 'phase-1',
            tournament_id: 'tournament-1',
            tournaments: {
              event_id: 'event-1',
              weapon: 'longsword',
              tournament_id: 'tournament-1',
              events: { organization_id: 'org-1' },
            },
          },
        },
        error: null,
      });
    }

    it('inserts one assignment per match in the pool, scoped to (match, role)', async () => {
      const editableChain = makeChain({ data: [], error: null });
      editableChain.in.mockResolvedValue({ data: [], error: null });
      // matches.select('id, lice_id').eq('pool_id', poolId) — list of pool matches
      const matchesListChain = makeChain({ data: null, error: null });
      matchesListChain.eq.mockResolvedValue({
        data: [
          { id: 'm-1', lice_id: 'lice-1' },
          { id: 'm-2', lice_id: null },
          { id: 'm-3', lice_id: 'lice-2' },
        ],
        error: null,
      });
      const insertedRows: Array<Record<string, unknown>> = [];
      const refereeChain = makeAwaitableDeleteChain();
      refereeChain.insert = vi.fn((rows: Record<string, unknown>[]) => {
        insertedRows.push(...rows);
        return Promise.resolve({ data: null, error: null });
      }) as never;

      fromMock
        .mockReturnValueOnce(poolContextChain())
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(matchesListChain)
        .mockReturnValueOnce(refereeChain) // delete pass
        .mockReturnValueOnce(refereeChain); // insert pass

      const result = await service.setPoolRefereeRoleAssignment(
        'pool-1',
        'arbitre_declarant',
        'person-7',
        'user-1',
      );

      expect(refereeChain.delete).toHaveBeenCalled();
      expect(insertedRows).toHaveLength(3);
      expect(insertedRows[0]).toMatchObject({
        event_id: 'event-1',
        person_id: 'person-7',
        scope_type: 'match',
        pool_id: null,
        match_id: 'm-1',
        lice_id: 'lice-1',
        role: 'arbitre_declarant',
        auto_assigned: false,
        status: 'assigned',
      });
      expect(insertedRows[1]).toMatchObject({ match_id: 'm-2', lice_id: null });
      expect(insertedRows[2]).toMatchObject({ match_id: 'm-3', lice_id: 'lice-2' });
      expect(result).toEqual({
        poolId: 'pool-1',
        role: 'arbitre_declarant',
        refereeId: 'person-7',
      });
    });

    it('only deletes existing assignments when refereeId is null', async () => {
      const editableChain = makeChain({ data: [], error: null });
      editableChain.in.mockResolvedValue({ data: [], error: null });
      const matchesListChain = makeChain({ data: null, error: null });
      matchesListChain.eq.mockResolvedValue({
        data: [{ id: 'm-1', lice_id: null }],
        error: null,
      });
      const insertSpy = vi.fn();
      const refereeChain = makeAwaitableDeleteChain();
      refereeChain.insert = insertSpy as never;

      fromMock
        .mockReturnValueOnce(poolContextChain())
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(matchesListChain)
        .mockReturnValueOnce(refereeChain);

      await service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_assesseur', null, 'user-1');

      expect(refereeChain.delete).toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });
  });

  // ── populateBracket — one-sided slots still reach the matches row ──────────

  /**
   * The play-in regression, at unit level.
   *
   * populateBracket used to write the matches row only when BOTH sides of a
   * slot were seeded, on the assumption that a one-sided slot is a bye. Double
   * elim never emits byes: a play-in bracket's WB-R1 slot has a null side
   * because it waits on `winner of WBR0Px`. The seeded side therefore stayed
   * NULL on the matches row forever, resolveLoser could not tell who lost, and
   * every `loser of WBR1Px` went unfilled — freezing the entire losers bracket,
   * grand final and reset. Caught end-to-end by tests/e2e/09-double-elim.spec.ts.
   *
   * Mocks dispatch on TABLE NAME rather than call order: this path's query
   * sequence is long and order-based mockReturnValueOnce chains desync the
   * moment a `from()` is added anywhere upstream.
   */
  describe('populateBracket — one-sided slot match rows', () => {
    it('writes the seeded side into the matches row when the other side is unresolved', async () => {
      const matchUpdates: Array<Record<string, unknown>> = [];
      const matchInserts: unknown[] = [];

      fromMock.mockImplementation((table: string) => {
        switch (table) {
          case 'phases': {
            // Both the bracket-phase lookup and the pool-phase lookup land
            // here; the pool lookup filters on type='pool' and must come back
            // empty so populate takes the registration-seed path.
            const chain = makeChain({ data: null, error: null });
            let sawPoolFilter = false;
            chain.eq.mockImplementation((col: string, val: string) => {
              if (col === 'type' && val === 'pool') sawPoolFilter = true;
              return chain;
            });
            chain.maybeSingle.mockImplementation(() =>
              Promise.resolve({
                data: sawPoolFilter
                  ? null
                  : {
                      id: 'bracket-phase-1',
                      type: 'double_elim',
                      config_json: { wbRounds: 3, lbRounds: 4 },
                      tournament_id: 'tournament-1',
                      tournaments: { events: { organization_id: 'org-1' } },
                    },
                error: null,
              }),
            );
            return chain;
          }
          case 'bracket_slots':
            // One play-in-fed WB-R1 slot: side A is `seed 1`, side B waits on
            // the play-in winner, so only A can be seeded now.
            return makeAwaitableChain({
              data: [
                {
                  id: 'slot-r1p1',
                  round: 1,
                  position: 1,
                  source_a_ref: 'seed 1',
                  source_b_ref: 'winner of WBR0P1',
                },
              ],
              error: null,
            });
          case 'matches': {
            const chain = makeChain({
              data: { id: 'match-r1p1', status: 'scheduled' },
              error: null,
            });
            chain.update.mockImplementation((payload: Record<string, unknown>) => {
              matchUpdates.push(payload);
              return chain;
            });
            chain.insert.mockImplementation((payload: unknown) => {
              matchInserts.push(payload);
              return chain;
            });
            // The blocking-matches guard awaits the chain directly.
            (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
              resolve({ data: [], error: null });
            return chain;
          }
          case 'registrations':
            return makeAwaitableChain({
              data: [{ id: 'reg-1', seed: 1, bib_number: null }],
              error: null,
            });
          case 'tournaments':
            return makeChain({
              data: { ruleset_code: 'TF', ruleset_version: '1.0.0' },
              error: null,
            });
          default:
            return makeAwaitableChain({ data: null, error: null });
        }
      });

      const svc = new PhasesService(mockSupabase as never, undefined, mockOrgs as never);
      await svc.populateBracket('tournament-1', {}, 'system');

      // The whole point: the known side reaches the matches row even though the
      // other side is still null. Previously this list was empty.
      expect(matchUpdates).toContainEqual({ red_registration_id: 'reg-1' });
      // And no phantom row is inserted for a slot that cannot be played yet.
      expect(matchInserts).toEqual([]);
    });
  });

  // ── populateBracket — perPool guard + source field ─────────────────────────

  describe('populateBracket — pool-gate honesty', () => {
    function bracketPhaseChain() {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: {
          id: 'bracket-phase-1',
          type: 'single_elim',
          config_json: {},
          tournament_id: 'tournament-1',
          tournaments: { events: { organization_id: 'org-1' } },
        },
        error: null,
      });
      return chain;
    }
    function emptyR1SlotsChain() {
      // r1Slots query — return empty so the blocking-matches lookup is
      // skipped (`slots.length > 0` guard) and we reach the pool gate.
      return makeAwaitableChain({ data: [], error: null });
    }
    function poolPhaseExistsChain() {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'pool-phase-1' }, error: null });
      return chain;
    }
    function poolPhaseAbsentChain() {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      return chain;
    }
    function registrationsChain(
      rows: Array<{ id: string; seed: number; bib_number: number | null }>,
    ) {
      return makeAwaitableChain({ data: rows, error: null });
    }
    function auditLogChain() {
      const chain = makeChain({ data: null, error: null });
      (chain.insert as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });
      return chain;
    }
    function makePoolStandingsMock(byPool: unknown, overall?: unknown) {
      return {
        getPoolStandings: vi
          .fn()
          .mockImplementation((_id: string, mode: 'by-pool' | 'overall') =>
            Promise.resolve(mode === 'overall' && overall !== undefined ? overall : byPool),
          ),
      };
    }

    it('refuses with ConflictException when pool phase exists but no pool data', async () => {
      const poolStandings = makePoolStandingsMock({ pools: [] });
      const svc = new PhasesService(
        mockSupabase as never,
        undefined,
        mockOrgs as never,
        undefined,
        undefined,
        poolStandings as never,
      );

      fromMock
        .mockReturnValueOnce(bracketPhaseChain())
        .mockReturnValueOnce(emptyR1SlotsChain())
        .mockReturnValueOnce(poolPhaseExistsChain());

      await expect(svc.populateBracket('tournament-1', {}, 'system')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('returns source="registration-seed" for straight-to-bracket tournaments', async () => {
      const svc = new PhasesService(
        mockSupabase as never,
        undefined,
        mockOrgs as never,
        undefined,
        undefined,
        undefined, // poolStandings not wired — registration-seed fallback still fires
      );

      fromMock
        .mockReturnValueOnce(bracketPhaseChain())
        .mockReturnValueOnce(emptyR1SlotsChain())
        .mockReturnValueOnce(poolPhaseAbsentChain())
        .mockReturnValueOnce(
          registrationsChain([
            { id: 'r1', seed: 1, bib_number: null },
            { id: 'r2', seed: 2, bib_number: null },
          ]),
        )
        .mockReturnValueOnce(auditLogChain());

      const result = await svc.populateBracket('tournament-1', {}, 'system');
      expect(result.source).toBe('registration-seed');
    });

    it('returns source="pool-standings" on the all-pools-complete happy path', async () => {
      const poolStandings = makePoolStandingsMock(
        {
          pools: [
            {
              poolId: 'p1',
              poolName: 'Pool 1',
              status: 'completed',
              rows: [{ rank: 1, registrationId: 'r1' }],
            },
            {
              poolId: 'p2',
              poolName: 'Pool 2',
              status: 'completed',
              rows: [{ rank: 1, registrationId: 'r2' }],
            },
          ],
        },
        {
          rows: [
            { rank: 1, registrationId: 'r1' },
            { rank: 2, registrationId: 'r2' },
          ],
        },
      );

      const svc = new PhasesService(
        mockSupabase as never,
        undefined,
        mockOrgs as never,
        undefined,
        undefined,
        poolStandings as never,
      );

      fromMock
        .mockReturnValueOnce(bracketPhaseChain())
        .mockReturnValueOnce(emptyR1SlotsChain())
        .mockReturnValueOnce(poolPhaseExistsChain())
        .mockReturnValueOnce(auditLogChain());

      const result = await svc.populateBracket('tournament-1', {}, 'system');
      expect(result.source).toBe('pool-standings');
    });
  });

  // ── Waiting list must not leak into pool building ─────────────────────────

  describe('listUnassignedFighters — waiting list excluded', () => {
    it('constrains the registrations query to active statuses (no waitlist/withdrawn)', async () => {
      const regsChain = makeAwaitableChain({ data: [], error: null });
      const poolMembersChain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'registrations') return regsChain;
        if (table === 'pool_members') return poolMembersChain;
        return makeAwaitableChain({ data: null, error: null });
      });
      vi.spyOn(
        service as unknown as { weightedRatingsForTournament: () => Promise<Map<string, number>> },
        'weightedRatingsForTournament',
      ).mockResolvedValue(new Map());

      await service.listUnassignedFighters('tournament-1');

      expect(regsChain.in).toHaveBeenCalledWith('status', ['registered', 'checked_in']);
    });
  });

  describe('addPoolMember — waiting list guard', () => {
    function stubPoolAuth() {
      vi.spyOn(
        service as unknown as { assertPoolEditAuth: () => Promise<{ tournamentId: string }> },
        'assertPoolEditAuth',
      ).mockResolvedValue({ tournamentId: 'tournament-1' });
      vi.spyOn(
        service as unknown as { assertPoolEditable: () => Promise<void> },
        'assertPoolEditable',
      ).mockResolvedValue(undefined);
      vi.spyOn(
        service as unknown as { regeneratePoolMatches: () => Promise<void> },
        'regeneratePoolMatches',
      ).mockResolvedValue(undefined);
    }

    it('rejects adding a waitlisted registration to a pool', async () => {
      stubPoolAuth();
      const regChain = makeChain({ data: { id: 'reg-1', status: 'waitlist' }, error: null });
      fromMock.mockImplementation((table: string) =>
        table === 'registrations' ? regChain : makeAwaitableChain({ data: [], error: null }),
      );

      await expect(service.addPoolMember('pool-1', 'reg-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still adds an active (registered) fighter', async () => {
      stubPoolAuth();
      const regChain = makeChain({ data: { id: 'reg-1', status: 'registered' }, error: null });
      fromMock.mockImplementation((table: string) =>
        table === 'registrations' ? regChain : makeAwaitableChain({ data: [], error: null }),
      );

      const result = await service.addPoolMember('pool-1', 'reg-1', 'user-1');
      expect(result).toMatchObject({ poolId: 'pool-1', registrationId: 'reg-1', moved: true });
    });
  });
});
