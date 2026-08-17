import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type ChainResult,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const legacyClient = { service: { from: fromMock }, anon: {} };
const mockOrgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

/**
 * One service over the shared Supabase double, which routes by TABLE NAME.
 *
 * What it replaces, describe by describe, is `fromMock.mockReturnValueOnce(a)
 * .mockReturnValueOnce(b)…` — a positional queue. Add one query anywhere
 * upstream and every later answer shifts by one while the suite stays green,
 * asserting against the wrong table. This file held 179 of those.
 *
 * The second gain is the one the falsification sweep asked for. A canned
 * `{ data }` answers the same thing whatever the query filters on, so no filter
 * in it can be load-bearing; of the 113 PostgREST filters in phases.service.ts,
 * 106 could be deleted with the whole 3,659-test API suite still green. A
 * `{ rows: [...] }` seed really applies `.eq`/`.in`/`.not`, so every filter in
 * the query starts deciding the answer at once.
 *
 * Seed `rows:` where the filtering is the point, `{ data }` where the test is
 * about a null or an error branch. A table nobody declared throws rather than
 * resolving quietly to `{ data: null }`, which is how the surface below got
 * corrected on contact.
 */
function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(seed);
  const service = new PhasesService(supabase as never, undefined, mockOrgs as never);
  return { service, supabase };
}

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
    neq: vi.fn(),
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
  for (const key of [
    'select',
    'eq',
    'neq',
    'in',
    'not',
    'limit',
    'order',
    'insert',
    'update',
    'delete',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PhasesService.generateBracket — authorization', () => {
  /**
   * `generateBracket` took no actor at all. `?force=true` DELETEs the phase and
   * cascades to every match under it — and with it every exchange, card,
   * forfeit, referee assignment, piste placement and scheduled time — so any
   * authenticated user could destroy any organisation's bracket, and nothing
   * was recorded. Its three siblings (populate, reseed, delete) have always
   * asserted org admin.
   */
  /**
   * Two tournaments, the WRONG one first.
   *
   * The org check reads `.eq('id', tournamentId).maybeSingle()`, and a seeded
   * table hands back whatever survived the filters — so dropping that one filter
   * resolves the other organisation, and the assertion below names it. On the
   * canned double this fixture replaced, the same deletion changed nothing.
   */
  const TOURNAMENTS: SupabaseRow[] = [
    { id: 't-elsewhere', events: { organization_id: 'org-elsewhere' } },
    { id: 't-1', events: { organization_id: 'org-1' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` resets calls, NOT implementations — re-establish the
    // permissive default so a `…Once` rejection below cannot leak into the
    // next describe if the code under test never consumes it.
    mockOrgs.assertOrgRole.mockResolvedValue(undefined);
  });

  it('asserts org admin before touching anything', async () => {
    const { service, supabase } = makeService({ tournaments: { rows: TOURNAMENTS } });
    mockOrgs.assertOrgRole.mockRejectedValue(new ForbiddenException('nope'));

    await expect(
      service.generateBracket('t-1', { phaseType: 'single_elim' } as never, true, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    // Refused before the destructive delete, not after it. `phases` is not
    // seeded at all, so reaching it throws at the moment of the violation
    // rather than resolving quietly and failing an assertion afterwards.
    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
  });

  it('refuses when the tournament resolves to no organisation', async () => {
    // The id matches nothing, which is the only way `maybeSingle()` returns
    // null here — the rows are present, the filter is what excludes them.
    const { service } = makeService({ tournaments: { rows: TOURNAMENTS } });

    await expect(
      service.generateBracket('t-missing', { phaseType: 'single_elim' } as never, true, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockOrgs.assertOrgRole).not.toHaveBeenCalled();
  });

  it('lets the system actor through, as the auto-advance paths rely on', async () => {
    // 'system' is the default and the sentinel populateBracket already uses.
    // No `tournaments` seed: the org lookup lives inside the actor branch, so
    // the system path must never reach it — and would throw if it did.
    const { service, supabase } = makeService({
      phases: { rows: [] },
      registrations: { rows: [] },
    });

    await service.generateBracket('t-1', { phaseType: 'single_elim' } as never).catch(() => {});

    expect(mockOrgs.assertOrgRole).not.toHaveBeenCalled();
    expect(queriedTables(supabase.from)).toEqual(['phases', 'registrations']);
  });
});

describe('PhasesService', () => {
  let service: PhasesService;

  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` drains call history, not the `…Once` queue: a rejection
    // queued by a test whose code path never reaches `assertOrgRole` lands on
    // whichever later test does. Re-establish the permissive default, as the
    // authorization describe above already does.
    mockOrgs.assertOrgRole.mockResolvedValue(undefined);
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new PhasesService(legacyClient as never, undefined, mockOrgs as never);
  });

  // ── generatePools — idempotency ───────────────────────────────────────────

  describe('generatePools — idempotency', () => {
    /**
     * A pool phase belonging to ANOTHER tournament, and the only row in its
     * table.
     *
     * It does two jobs. It makes `.eq('tournament_id', …)` on the existing-phase
     * check load-bearing: drop that filter and a regeneration that should have
     * proceeded finds this row and refuses with a 409. And it is a single row on
     * purpose — the phase insert reads the same seeded table back through
     * `.select('id').single()`, which is a PGRST116 on two rows, so a second
     * decoy would fail the insert rather than the filter. Hence one decoy per
     * test, each aimed at a different filter.
     */
    const POOL_PHASE_ELSEWHERE: SupabaseRow = {
      id: 'phase-elsewhere',
      tournament_id: 'other-tournament',
      type: 'pool',
    };

    /** The same trick for `.eq('type', 'pool')`: right tournament, wrong type. */
    const BRACKET_PHASE_HERE: SupabaseRow = {
      id: 'phase-bracket',
      tournament_id: 'tournament-1',
      type: 'single_elim',
    };

    /** Wrong tournament FIRST, so dropping `.eq('id', …)` resolves the wrong org. */
    const TOURNAMENTS: SupabaseRow[] = [
      {
        id: 'other-tournament',
        weapon: null,
        event_id: 'event-9',
        events: { organization_id: 'org-elsewhere' },
      },
      {
        id: 'tournament-1',
        weapon: null,
        event_id: 'event-1',
        events: { organization_id: 'org-1' },
      },
    ];

    /** A registration row as the pool generator reads it, embed and all. */
    const reg = (id: string, seed: number, over: SupabaseRow = {}): SupabaseRow => ({
      id,
      seed,
      bib_number: null,
      tournament_id: 'tournament-1',
      status: 'registered',
      persons: { club_id: null, global_persons: null },
      ...over,
    });

    /**
     * Two registrations the query must not return: one from another tournament,
     * one withdrawn. Every test below counts fighters to decide the pool maths,
     * so either one leaking in changes the answer — which is what makes
     * `.eq('tournament_id', …)` and `.in('status', …)` load-bearing.
     */
    const REG_DECOYS: SupabaseRow[] = [
      reg('r-elsewhere', 9, { tournament_id: 'other-tournament' }),
      reg('r-withdrawn', 9, { status: 'withdrawn' }),
    ];

    it('throws ConflictException when pool phase already exists (no force)', async () => {
      // Only `phases` is seeded: the refusal has to land before the tournament
      // read, and an unseeded table throws if it ever stops doing so.
      const { service } = makeService({
        phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
      });

      await expect(service.generatePools('tournament-1', {}, false)).rejects.toThrow(
        ConflictException,
      );
    });

    it('deletes existing phase and regenerates when force=true', async () => {
      const { service, supabase } = makeService({
        // One row, the phase being replaced — the insert reads this table back.
        phases: { rows: [{ id: 'old-phase', tournament_id: 'tournament-1', type: 'pool' }] },
        // The tournament read moved AHEAD of the delete: the force path's
        // scored-bout guard needs the owning org, and asking once the phase is
        // gone is asking too late. It also embeds events(organization_id).
        tournaments: { rows: TOURNAMENTS },
        // Nothing in the old phase was ever fought, so force proceeds without
        // `discardScoredResults`. The completed bout belongs to another phase:
        // drop `.eq('phase_id', …)` and the guard finds it and refuses; drop
        // `.in('status', …)` and the scheduled one refuses instead.
        matches: {
          rows: [
            { id: 'm-untouched', phase_id: 'old-phase', status: 'scheduled' },
            { id: 'm-elsewhere', phase_id: 'another-phase', status: 'completed' },
          ],
        },
        registrations: {
          rows: [
            reg('r1', 1, { persons: { club_id: 'club-1', global_persons: null } }),
            reg('r2', 2, { persons: { club_id: 'club-2', global_persons: null } }),
            reg('r3', 3, { persons: { club_id: 'club-1', global_persons: null } }),
            reg('r4', 4, { persons: { club_id: 'club-2', global_persons: null } }),
            ...REG_DECOYS,
          ],
        },
        pools: { rows: [{ id: 'pool-1' }] },
        pool_members: { rows: [] },
      });

      // Should not throw
      await expect(
        service.generatePools('tournament-1', { poolCount: 2 }, true),
      ).resolves.toBeDefined();

      // The delete names the row it took, which is the whole of what stands
      // between a regeneration and another tournament's pools.
      const [deleted, inserted] = writesTo(supabase, 'phases');
      expect(deleted?.op).toBe('delete');
      expect(scopedTo(deleted, 'id')).toBe('old-phase');
      expect(inserted?.row).toMatchObject({ visibility_status: 'hidden' });
    });

    // ── force=true is not a licence to delete fought bouts ────────────────
    // The force path raw-DELETEs the phase, and the CASCADE takes matches and
    // with them exchanges, penalties, events, forfeits and referee assignments.
    // It used to check only that the phase existed.
    describe('force=true vs scored bouts', () => {
      /**
       * The force path with `scored` bouts already fought in the phase it would
       * delete.
       *
       * The two rows always present are decoys, one per filter on the guard: a
       * bout in ANOTHER phase that HAS been fought, and one in this phase that
       * has not. Drop `.eq('phase_id', …)` or `.in('status', …)` and a clean
       * regeneration starts refusing.
       */
      function seedForceRegeneration(scored: SupabaseRow[]) {
        return makeService({
          phases: { rows: [{ id: 'old-phase', tournament_id: 'tournament-1', type: 'pool' }] },
          tournaments: { rows: TOURNAMENTS },
          matches: {
            rows: [
              { id: 'm-untouched', phase_id: 'old-phase', status: 'scheduled' },
              { id: 'm-elsewhere', phase_id: 'another-phase', status: 'completed' },
              ...scored,
            ],
          },
          registrations: { rows: REG_DECOYS },
          pools: { rows: [{ id: 'pool-1' }] },
          pool_members: { rows: [] },
        });
      }

      /** `n` bouts in the phase under threat, each of them fought. */
      const scoredBouts = (n: number): SupabaseRow[] =>
        Array.from({ length: n }, (_, i) => ({
          id: `m-scored-${i + 1}`,
          phase_id: 'old-phase',
          status: 'completed',
        }));

      it('refuses, naming the count, when a bout in the phase has been scored', async () => {
        const { service } = seedForceRegeneration(scoredBouts(2));

        await expect(
          service.generatePools('tournament-1', {}, true, 'user-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('does not delete the phase when it refuses', async () => {
        const { service, supabase } = seedForceRegeneration(scoredBouts(1));

        await service.generatePools('tournament-1', {}, true, 'user-1').catch(() => undefined);

        // The whole point: the 409 has to land BEFORE the CASCADE.
        expect(writesTo(supabase, 'phases')).toEqual([]);
      });

      it('refuses the override for an admin — discarding results is an owner call', async () => {
        const { service } = seedForceRegeneration(scoredBouts(1));
        mockOrgs.assertOrgRole.mockRejectedValueOnce(new ForbiddenException('not an owner'));

        await expect(
          service.generatePools('tournament-1', { discardScoredResults: true }, true, 'user-1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // Names the org the tournament actually belongs to — the seed holds a
        // second tournament under a different one, so the read has to be scoped.
        expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'owner');
      });

      it('refuses the override when no actor can be identified', async () => {
        const { service } = seedForceRegeneration(scoredBouts(1));

        // Fail CLOSED. The override lets a named human accept a permanent loss;
        // "we could not work out who you are" is not that.
        await expect(
          service.generatePools('tournament-1', { discardScoredResults: true }, true, undefined),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    // ── One piste runs one bout at a time ─────────────────────────────────
    // reschedulePool and autoDistributePool both pick a piste AND a time, so a
    // collision means they picked a taken one. setPoolLice picks only a piste
    // and stays deliberately unguarded — see assertPoolPlacementsFree.
    describe('piste double-booking', () => {
      const POOL_CONTEXT = {
        id: 'pool-1',
        name: 'A',
        phase_id: 'phase-1',
        sort_order: 0,
        phases: {
          id: 'phase-1',
          tournament_id: 't-1',
          tournaments: {
            event_id: 'event-1',
            weapon: null,
            events: { organization_id: 'org-1' },
          },
        },
      };

      /**
       * The pool being moved: two bouts, five minutes apart, already on the
       * piste they are being re-placed on.
       *
       * Already on it because that is what makes `.neq('pool_id', poolId)` on
       * the occupant read load-bearing. Shifted five minutes, each bout lands
       * where its SIBLING used to sit — so if the pool's own rows are not
       * excluded from the occupant list, a re-save of a placement the pool
       * already holds refuses itself. The service docstring says so; nothing
       * held it.
       */
      const POOL_MATCHES: SupabaseRow[] = [
        {
          id: 'm-1',
          pool_id: 'pool-1',
          lice_id: 'lice-1',
          status: 'scheduled',
          match_number_label: 'A1',
          scheduled_at: '2026-05-21T10:00:00.000Z',
        },
        {
          id: 'm-2',
          pool_id: 'pool-1',
          lice_id: 'lice-1',
          status: 'scheduled',
          match_number_label: 'A2',
          scheduled_at: '2026-05-21T10:05:00.000Z',
        },
      ];

      /**
       * Two rows the scoped reads must each skip:
       *  - `m-cancelled` sits on the target piste at the target minute and is
       *    voided, so only `.not('status', 'eq', 'voided')` keeps it out of the
       *    occupant list;
       *  - `m-other-pool-done` is a fought bout in another pool on another
       *    piste, so only `.eq('pool_id', …)` on the scored-bout guard stops it
       *    locking this pool.
       */
      const DECOYS: SupabaseRow[] = [
        {
          id: 'm-cancelled',
          pool_id: 'pool-9',
          lice_id: 'lice-1',
          status: 'voided',
          match_number_label: 'B1',
          scheduled_at: '2026-05-21T10:06:00.000Z',
        },
        {
          id: 'm-other-pool-done',
          pool_id: 'pool-9',
          lice_id: 'lice-2',
          status: 'completed',
          match_number_label: 'B2',
          scheduled_at: '2026-05-21T10:06:00.000Z',
        },
      ];

      /** The pool, its bouts, the decoys, and whatever else holds the piste. */
      function seedPoolMove(occupants: SupabaseRow[] = []) {
        return makeService({
          pools: { rows: [POOL_CONTEXT] },
          matches: { rows: [...POOL_MATCHES, ...DECOYS, ...occupants] },
        });
      }

      /** Five minutes on, onto the piste the pool already sits on. */
      const moveTo1005 = { liceId: 'lice-1', startAtIso: '2026-05-21T10:05:00.000Z' };

      it('reschedulePool refuses onto an occupied piste, and writes nothing', async () => {
        const { service, supabase } = seedPoolMove([
          {
            id: 'm-someone-else',
            pool_id: 'pool-9',
            lice_id: 'lice-1',
            status: 'scheduled',
            match_number_label: 'B3',
            scheduled_at: '2026-05-21T10:06:00.000Z',
          },
        ]);

        await expect(service.reschedulePool('pool-1', moveTo1005, 'user-1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        // Checked on the WHOLE set before the first UPDATE, so a refusal cannot
        // leave half a pool moved.
        expect(writesTo(supabase, 'matches')).toEqual([]);
      });

      it('reschedulePool proceeds when the piste is free', async () => {
        const { service, supabase } = seedPoolMove();

        await expect(service.reschedulePool('pool-1', moveTo1005, 'user-1')).resolves.toBeDefined();
        // One UPDATE per bout, each naming its own row.
        expect(writesTo(supabase, 'matches').map((write) => scopedTo(write, 'id'))).toEqual([
          'm-1',
          'm-2',
        ]);
      });
    });

    it('caps poolCount so no pool is forced to be a singleton (5 fighters, targetSize=2 → 2 pools)', async () => {
      // Prod 500 repro: with targetSize=2 and an odd fighterCount, the old
      // Math.ceil math produced poolCount=3 and snakeSeed left one pool with
      // a single fighter — bergerSchedule(1) then threw and the request
      // crashed inside the NestJS handler. After the cap, poolCount=2 and
      // the distribution is [3, 2].
      const { service } = makeService({
        // The decoy belongs to another tournament: drop the scoping filter and
        // this un-forced call finds a pool phase and refuses with a 409.
        phases: { rows: [POOL_PHASE_ELSEWHERE] },
        tournaments: { rows: TOURNAMENTS },
        registrations: {
          rows: [...Array.from({ length: 5 }, (_, i) => reg(`r${i + 1}`, i + 1)), ...REG_DECOYS],
        },
        pools: { rows: [{ id: 'pool-x' }] },
        pool_members: { rows: [] },
        matches: { rows: [] },
      });

      const result = await service.generatePools('tournament-1', { targetSize: 2 }, false);
      expect(result.poolCount).toBe(2);
    });

    it('does not throw when a pool ends up with a single fighter (defensive guard)', async () => {
      // Corner case: operator stands up a layout with a single registration
      // (e.g. preview before the rest of the roster lands). The pool gets
      // written + the lone pool_member gets inserted, but bergerSchedule is
      // skipped so we don't crash on n<2. totalMatches stays 0.
      const { service } = makeService({
        // This decoy is the same tournament's BRACKET phase: drop
        // `.eq('type', 'pool')` and the check finds it and refuses.
        phases: { rows: [BRACKET_PHASE_HERE] },
        tournaments: { rows: TOURNAMENTS },
        registrations: { rows: [reg('r1', 1), ...REG_DECOYS] },
        pools: { rows: [{ id: 'pool-1' }] },
        pool_members: { rows: [] },
        matches: { rows: [] },
      });

      const result = await service.generatePools('tournament-1', { poolCount: 1 }, false);
      expect(result.poolCount).toBe(1);
      expect(result.totalMatches).toBe(0);
    });

    it('creates empty pools when there are zero registrations (operator pre-stages the layout)', async () => {
      const { service, supabase } = makeService({
        phases: { rows: [POOL_PHASE_ELSEWHERE] },
        tournaments: { rows: TOURNAMENTS },
        // Only the two decoys. Either one leaking in gives 3 pools for 1
        // fighter, which is the 400 below the count guard exists to raise.
        registrations: { rows: REG_DECOYS },
        pools: { rows: [{ id: 'pool-1' }] },
        pool_members: { rows: [] },
      });

      const result = await service.generatePools('tournament-1', { poolCount: 3 }, false);
      expect(result.poolCount).toBe(3);
      expect(result.totalMatches).toBe(0);
      // pool_members.insert must NOT be called with [] (used to surface as a
      // 500). `matches` is not seeded either — an empty pool writes to neither,
      // and the double throws on a table nobody declared.
      expect(writesTo(supabase, 'pool_members')).toEqual([]);
    });
  });

  // ── Pool lifecycle — delete one / delete all / add empty ──────────────────

  describe('pool lifecycle', () => {
    it('addEmptyPool stands up a new phase + one pool when none exists', async () => {
      const { service, supabase } = makeService({
        // Wrong tournament first, so dropping `.eq('id', …)` resolves the
        // wrong organisation and the role assertion below names it.
        tournaments: {
          rows: [
            { id: 'other-tournament', events: { organization_id: 'org-elsewhere' } },
            { id: 'tournament-1', events: { organization_id: 'org-1' } },
          ],
        },
        // Another tournament's pool phase. There is none HERE, so one is stood
        // up — and `insert(...).select('id').single()` reads this same row
        // back, which is why there is one decoy and not two.
        phases: {
          rows: [{ id: 'phase-elsewhere', tournament_id: 'other-tournament', type: 'pool' }],
        },
        // Likewise: this pool hangs off another phase, so the "max sort_order"
        // read finds nothing and the new pool is Pool 1 at sort_order 0.
        pools: { rows: [{ id: 'pool-1', name: 'Pool 1', sort_order: 0, phase_id: 'phase-9' }] },
      });

      const result = await service.addEmptyPool('tournament-1', 'user-1');

      expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
      // A phase was created rather than an existing one adopted.
      expect(writesTo(supabase, 'phases')).toHaveLength(1);
      // What was WRITTEN, not what the fixture handed back: the sort_order is
      // computed from the pools already in this phase, and there are none.
      expect(writesTo(supabase, 'pools')[0]?.row).toMatchObject({ name: 'Pool 1', sort_order: 0 });
      expect(result).toMatchObject({ id: 'pool-1', name: 'Pool 1', sortOrder: 0 });
    });

    it('deleteAllPools is a no-op when there is no pool phase', async () => {
      // One decoy per filter on the lookup: another tournament's pool phase,
      // and this tournament's BRACKET phase. Neither is this tournament's pool
      // phase — and dropping either filter finds one of them and walks on into
      // a `tournaments` read that is not seeded at all.
      const { service, supabase } = makeService({
        phases: {
          rows: [
            { id: 'pool-elsewhere', tournament_id: 'other-tournament', type: 'pool' },
            { id: 'bracket-here', tournament_id: 'tournament-1', type: 'single_elim' },
          ],
        },
      });

      // Should resolve without throwing or making destructive calls.
      await expect(service.deleteAllPools('tournament-1', 'user-1')).resolves.toBeUndefined();
      expect(queriedTables(supabase.from)).toEqual(['phases']);
      expect(supabase.writes).toEqual([]);
    });

    /**
     * `deletePool` and `regeneratePoolMatches` both refuse once a bout in the
     * pool has been scored. `deleteAllPools` did the strictly more destructive
     * thing — one DELETE across every pool in the phase — behind an org-role
     * check alone, so a played round of pools could be erased outright. The
     * delete takes each match's exchanges, penalties, events and forfeit records
     * with it through ON DELETE CASCADE; there is nothing left to recover from.
     */
    it('deleteAllPools refuses once any bout in the phase has been scored', async () => {
      const { service, supabase } = makeService({
        phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
        tournaments: { rows: [{ id: 'tournament-1', events: { organization_id: 'org-1' } }] },
        matches: { rows: [{ id: 'match-9', phase_id: 'phase-1', status: 'completed' }] },
      });

      await expect(service.deleteAllPools('tournament-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      // Refused BEFORE the destructive call, not after it. `pools` and
      // `pool_members` are not seeded either, so the cascade cannot even reach
      // them without throwing.
      expect(supabase.writes).toEqual([]);
    });

    it('deleteAllPools proceeds when nothing in the phase has been scored', async () => {
      const { service, supabase } = makeService({
        phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
        tournaments: { rows: [{ id: 'tournament-1', events: { organization_id: 'org-1' } }] },
        matches: {
          rows: [
            { id: 'm-1', phase_id: 'phase-1', status: 'scheduled' },
            // Fought, but in another phase: `.eq('phase_id', …)` on the guard
            // is the only thing stopping it locking this one.
            { id: 'm-elsewhere', phase_id: 'phase-9', status: 'completed' },
          ],
        },
        pools: {
          rows: [
            { id: 'pool-1', phase_id: 'phase-1' },
            { id: 'pool-9', phase_id: 'phase-9' },
          ],
        },
        pool_members: { rows: [] },
      });

      await expect(service.deleteAllPools('tournament-1', 'user-1')).resolves.toBeUndefined();

      // The documented order — matches, members, pools, phase — with every
      // statement naming what it is allowed to take. A `pool_members` delete
      // that reached pool-9 would take another phase's roster with it.
      expect(supabase.writes.map((write) => `${write.table}.${write.op}`)).toEqual([
        'matches.delete',
        'pool_members.delete',
        'pools.delete',
        'phases.delete',
      ]);
      expect(scopedTo(writesTo(supabase, 'matches')[0], 'phase_id')).toBe('phase-1');
      expect(writesTo(supabase, 'pool_members')[0]?.filters).toEqual([
        { method: 'in', args: ['pool_id', ['pool-1']] },
      ]);
      expect(scopedTo(writesTo(supabase, 'pools')[0], 'phase_id')).toBe('phase-1');
      expect(scopedTo(writesTo(supabase, 'phases')[0], 'id')).toBe('phase-1');
    });
  });

  // ── generateBracket — idempotency ─────────────────────────────────────────

  describe('generateBracket — idempotency', () => {
    /**
     * The answers `generateBracket` wants from `phases`, in the order it asks.
     *
     * This one table stays a per-table QUEUE rather than a `{ rows }` seed,
     * because its four reads want four different things: nothing on the
     * existence check, the new id back from the insert, the stored config on
     * the read-back, and nothing again on the pool gate. A seeded table is a
     * fixture and not a database — a write does not change what the next read
     * of the same table returns — so no single seed can answer all four.
     *
     * The ordering that leaves behind is real, but it is scoped to ONE table
     * and written next to its own answers. A new query on bracket_slots,
     * matches or registrations can no longer shift it, and that cross-table
     * shift is the desync this migration exists to remove.
     */
    const phasesQueue = (
      config: Record<string, unknown>,
      opts: { type?: string; bronzeUpdate?: boolean; rulesetLookup?: boolean } = {},
    ): ChainResult[] => [
      { data: null, error: null }, // 1. existence check — no elim phase yet
      { data: { id: 'phase-new' }, error: null }, // 2. insert … .select('id').single()
      // 3. the bronzeSlotId config update, whose result the service discards
      ...(opts.bronzeUpdate ? [{ data: null, error: null }] : []),
      // 4. matchRulesetForPhase — null falls back to the TF_v1 stamp
      ...(opts.rulesetLookup ? [{ data: null, error: null }] : []),
      {
        // 5. getTournamentBracket reads the phase back
        data: {
          id: 'phase-new',
          type: opts.type ?? 'single_elim',
          visibility_status: 'hidden',
          config_json: config,
        },
        error: null,
      },
      { data: null, error: null }, // 6. pool gate — straight-to-bracket
    ];

    /** `n` qualifying registrations, plus the two rows the query must skip. */
    const qualifiers = (n: number): SupabaseRow[] => [
      ...Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        tournament_id: 'tournament-1',
        status: 'registered',
      })),
      { id: 'r-elsewhere', tournament_id: 'other-tournament', status: 'registered' },
      { id: 'r-withdrawn', tournament_id: 'tournament-1', status: 'withdrawn' },
    ];

    it('throws ConflictException when bracket phase already exists (no force)', async () => {
      const { service } = makeService({
        phases: {
          rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'single_elim' }],
        },
      });

      await expect(service.generateBracket('tournament-1', {}, false)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when fewer than 2 fighters qualify', async () => {
      const { service } = makeService({
        phases: { rows: [] },
        registrations: { rows: qualifiers(1) },
      });

      // Named, not just typed: either decoy leaking into the count also ends in
      // a BadRequestException — from the phase insert, several steps later —
      // so only the message distinguishes the guard from the wreckage.
      await expect(service.generateBracket('tournament-1', {}, false)).rejects.toThrow(
        'Need at least 2 fighters to generate a bracket',
      );
    });

    it('throws BadRequestException when generated bracket would exceed 128 slots', async () => {
      const { service } = makeService({ phases: { rows: [] } });

      await expect(
        service.generateBracket('tournament-1', { qualifyCount: 256 }, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates bracket with correct structure for 8 fighters', async () => {
      const { service, supabase } = makeService({
        // Trailing reads come from the post-write getTournamentBracket()
        // delegation: generateBracket reads the canonical shape back so the
        // response matches what GET /tournaments/:id/bracket returns.
        phases: phasesQueue(
          {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            byeSeedCount: 0,
            playInMatchCount: 0,
            hasPlayInRound: false,
            rounds: 3,
          },
          { rulesetLookup: true },
        ),
        registrations: { rows: qualifiers(8) },
        // Eight slots for this phase, and one for another — the read-back is
        // scoped by phase_id, and a ninth slot in the response would be
        // another bracket's.
        bracket_slots: {
          rows: [
            ...Array.from({ length: 8 }, (_, i) => ({
              id: `s${i}`,
              phase_id: 'phase-new',
              round: 0,
              position: i,
            })),
            { id: 's-elsewhere', phase_id: 'phase-9', round: 0, position: 9 },
          ],
        },
        matches: { rows: [] },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      });

      const result = await service.generateBracket('tournament-1', {}, false);
      expect(writesTo(supabase, 'phases')[0]?.row).toMatchObject({ visibility_status: 'hidden' });
      expect((result as { bracketSize: number }).bracketSize).toBe(8);
      expect((result as { rounds: number }).rounds).toBe(3);
      expect((result as { byeCount: number }).byeCount).toBe(0);
      expect((result as { totalSlots: number }).totalSlots).toBe(8); // 4+2+1+bronze
      // New: the response now exposes the `slots` array the client renders.
      expect((result as { slots: unknown[] }).slots).toHaveLength(8);
    });

    it('respects explicit bracketSize option', async () => {
      const { service } = makeService({
        phases: phasesQueue(
          {
            bracketSize: 8,
            fighterCount: 6,
            byeCount: 2,
            byeSeedCount: 2,
            playInMatchCount: 0,
            hasPlayInRound: false,
            rounds: 3,
          },
          { rulesetLookup: true },
        ),
        registrations: { rows: qualifiers(6) },
        bracket_slots: {
          rows: Array.from({ length: 8 }, (_, i) => ({
            id: `s${i}`,
            phase_id: 'phase-new',
            round: 0,
            position: i,
          })),
        },
        matches: { rows: [] },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      });

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

      void regs; // explicit qualifyCount in DTO; registrations fetch no longer happens

      const { service, supabase } = makeService({
        phases: phasesQueue(
          {
            bracketSize: 16,
            mainBracketSize: 16,
            fighterCount: 18,
            byeCount: 14,
            byeSeedCount: 14,
            playInMatchCount: 2,
            hasPlayInRound: true,
            rounds: 4,
          },
          { rulesetLookup: true },
        ),
        // createInitialBracketMatches pre-creates a matches row for every
        // non-bye slot, play-in slots with null registrations included, so
        // these two are what come back from `insert(...).select(...)`.
        bracket_slots: {
          rows: [
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
        },
        matches: { rows: [] },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      });

      const result = await service.generateBracket('tournament-1', { qualifyCount: 18 }, false);

      expect(writesTo(supabase, 'phases')[0]?.row).toMatchObject({
        config_json: expect.objectContaining({
          bracketSize: 16,
          mainBracketSize: 16,
          fighterCount: 18,
          byeCount: 14,
          byeSeedCount: 14,
          playInMatchCount: 2,
          hasPlayInRound: true,
        }),
      });
      expect(writesTo(supabase, 'bracket_slots')[0]?.row).toEqual(
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
        // A service per strategy, so nothing has to be reset between them.
        const { service, supabase } = makeService({
          phases: phasesQueue({ bracketSize: 8, seedingStrategy: strategy }),
          registrations: { rows: qualifiers(8) },
          // No slots come back, so no placeholder matches and no ruleset
          // lookup — hence no `rulesetLookup` entry in the queue above.
          bracket_slots: { rows: [] },
          tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
        });

        const result = await service.generateBracket(
          'tournament-1',
          { seedingStrategy: strategy },
          false,
        );

        expect(writesTo(supabase, 'phases')[0]?.row).toMatchObject({
          config_json: expect.objectContaining({ seedingStrategy: strategy }),
        });
        expect((result as { seedingStrategy: string }).seedingStrategy).toBe(strategy);
      }
    });

    it('persists seedingStrategy and grandFinalReset into phases.config_json', async () => {
      const { service, supabase } = makeService({
        phases: phasesQueue(
          {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            grandFinalReset: true,
            seedingStrategy: 'snake',
          },
          { type: 'double_elim' },
        ),
        registrations: { rows: qualifiers(8) },
        bracket_slots: { rows: [] },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      });

      const result = await service.generateBracket(
        'tournament-1',
        { phaseType: 'double_elim', grandFinalReset: true },
        false,
      );

      expect(writesTo(supabase, 'phases')[0]?.row).toMatchObject({
        config_json: expect.objectContaining({
          grandFinalReset: true,
          seedingStrategy: 'snake',
        }),
      });
      expect((result as { grandFinalReset: boolean }).grandFinalReset).toBe(true);
      expect((result as { seedingStrategy: string }).seedingStrategy).toBe('snake');
    });

    /**
     * Table-name dispatch rather than ordered mockReturnValueOnce: this path
     * fans out to phases / bracket_slots / matches in an order that shifts
     * whenever a lookup is added, and an ordered queue silently desyncs.
     */
    it('generates a play-in round and leaves the conditional reset match uncreated', async () => {
      const dto = { phaseType: 'double_elim', grandFinalReset: true } as const;
      const registrations = { rows: qualifiers(12) };
      const tournaments = { rows: [{ id: 'tournament-1', event_id: null }] };

      /**
       * Run it once with no slots seeded, purely to record what the generator
       * emits.
       *
       * PostgREST hands the inserted rows back, ids and all, from
       * `insert(...).select(...)`; a seeded table cannot, because it is a
       * fixture and not a database. So the echo is built HERE from the
       * generator's own output rather than from a literal that could quietly
       * drift away from it — and the second pass below replays the same call
       * against it.
       */
      const probe = makeService({
        phases: phasesQueue({ bracketSize: 8 }, { type: 'double_elim' }),
        registrations,
        bracket_slots: { rows: [] },
        tournaments,
      });
      await probe.service.generateBracket('tournament-1', dto, false);
      const emitted = writesTo(probe.supabase, 'bracket_slots')[0]?.row as Array<
        Record<string, unknown>
      >;
      // Annotated: spreading a Record<string, unknown> narrows to `{ id: string }`
      // on inference, and the round lookups below then stop compiling.
      const slotRows: SupabaseRow[] = emitted.map((row, i) => ({ ...row, id: `slot-${i}` }));

      const { service, supabase } = makeService({
        phases: phasesQueue({ bracketSize: 8 }, { type: 'double_elim', rulesetLookup: true }),
        registrations,
        bracket_slots: { rows: slotRows },
        matches: { rows: [] },
        tournaments,
      });
      await service.generateBracket('tournament-1', dto, false);

      // 12 fighters trim to an 8-bracket, so 4 play-in matches sit at round 0.
      expect(emitted.filter((s) => s['round'] === 0).length).toBe(4);
      // No byes: a bye has no loser, and the losers bracket feeds off WB losers.
      expect(emitted.some((s) => s['source_a_ref'] === 'bye')).toBe(false);

      // wbRounds=3, lbRounds=4 → GF is round 8 and the reset round 9. The reset
      // is only PLAYED when the losers-bracket entrant wins the grand final, so
      // it must not get a placeholder match at generation time.
      const resetSlotIds = slotRows.filter((r) => r['round'] === 9).map((r) => r['id']);
      expect(resetSlotIds.length).toBe(1);
      const matchSlotIds = (
        writesTo(supabase, 'matches')[0]?.row as Array<{ bracket_slot_id: string }>
      ).map((m) => m.bracket_slot_id);
      expect(matchSlotIds).not.toContain(resetSlotIds[0]);
      // Every other slot does get one.
      expect(matchSlotIds.length).toBe(slotRows.length - 1);
    });

    it('captures bronzeSlotId on single-elim and exposes it on the bracket read', async () => {
      const { service, supabase } = makeService({
        // createInitialBracketMatches pre-creates a matches row for every
        // non-bye slot (R1, R2+, bronze) even with registrations still null,
        // so both the bronze config update and the matchRulesetForPhase lookup
        // land between the insert and the read-back.
        phases: phasesQueue(
          {
            bracketSize: 8,
            fighterCount: 8,
            byeCount: 0,
            rounds: 3,
            seedingStrategy: 'snake',
            bronzeSlotId: 'slot-bronze',
          },
          { bronzeUpdate: true, rulesetLookup: true },
        ),
        registrations: { rows: qualifiers(8) },
        // The insert reads these back, and the bronze slot is the one carrying
        // source_a_type='loser_of'.
        bracket_slots: {
          rows: [
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
        },
        matches: { rows: [] },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      });

      const result = await service.generateBracket('tournament-1', {}, false);

      const [inserted, updated] = writesTo(supabase, 'phases');
      expect(inserted?.op).toBe('insert');
      expect(updated?.op).toBe('update');
      expect(updated?.row).toMatchObject({
        config_json: expect.objectContaining({ bronzeSlotId: 'slot-bronze' }),
      });
      // The update names the phase it stamps, not every phase in the table.
      expect(scopedTo(updated, 'id')).toBe('phase-new');
      expect((result as { bronzeSlotId: string | null }).bronzeSlotId).toBe('slot-bronze');
    });
  });

  describe('updateVisibility', () => {
    /**
     * The phase under edit, and one belonging to somebody else.
     *
     * The decoy comes FIRST, so dropping `.eq('id', phaseId)` from any of the
     * three `phases` statements resolves the wrong phase — a different
     * organisation on the read, a PGRST116 on the update's `single()`.
     */
    const phases = (over: SupabaseRow = {}): SupabaseRow[] => [
      {
        id: 'phase-elsewhere',
        type: 'pool',
        tournament_id: 'tournament-9',
        visibility_status: 'hidden',
        tournaments: { event_id: 'event-9', events: { organization_id: 'org-elsewhere' } },
      },
      {
        id: 'phase-1',
        type: 'pool',
        tournament_id: 'tournament-1',
        visibility_status: 'hidden',
        tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
        ...over,
      },
    ];

    it('publishes a phase and writes an audit log', async () => {
      const { service, supabase } = makeService({
        // Seeded as published because a seeded table is a fixture, not a
        // database: the write is recorded rather than applied, so this row is
        // what the UPDATE … RETURNING hands back. What the update SET is
        // asserted from the recorded write below.
        phases: { rows: phases({ visibility_status: 'published' }) },
        audit_log: { rows: [] },
      });

      await expect(
        service.updateVisibility('phase-1', 'actor-1', { visibility: 'published' }),
      ).resolves.toMatchObject({ visibility_status: 'published' });
      expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'actor-1', 'admin');

      const [updated] = writesTo(supabase, 'phases');
      expect(updated?.row).toMatchObject({
        visibility_status: 'published',
        published_by_user_id: 'actor-1',
      });
      expect(scopedTo(updated, 'id')).toBe('phase-1');
      expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
        action: 'phase.visibility_published',
      });
    });

    it('requires confirmation before hiding a phase with started or completed matches', async () => {
      const { service } = makeService({
        phases: { rows: phases({ type: 'single_elim', visibility_status: 'published' }) },
        matches: {
          rows: [
            { id: 'match-1', phase_id: 'phase-1', status: 'running' },
            { id: 'match-2', phase_id: 'phase-1', status: 'completed' },
            // Another phase's finished bout. The counts are exact, so
            // `.eq('phase_id', …)` slipping would raise completedMatchCount.
            { id: 'match-elsewhere', phase_id: 'phase-9', status: 'completed' },
          ],
        },
      });

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
    /**
     * One phase row answers both `phases` reads — getPhaseForVisibility and the
     * config_json fetch ask the same row for different columns — and the
     * update's `.eq('id', …).select(…).single()` narrows to it as well. The
     * decoy in front is what makes that filter load-bearing on all three.
     */
    function bracketPhases(
      config: Record<string, unknown>,
      type: 'single_elim' | 'double_elim' = 'double_elim',
    ): SupabaseRow[] {
      return [
        {
          id: 'phase-elsewhere',
          type: 'double_elim',
          tournament_id: 'tournament-9',
          visibility_status: 'hidden',
          tournaments: { event_id: 'event-9', events: { organization_id: 'org-elsewhere' } },
          config_json: {},
        },
        {
          id: 'phase-1',
          type,
          tournament_id: 'tournament-1',
          visibility_status: 'hidden',
          tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
          config_json: config,
        },
      ];
    }

    /**
     * Nothing completed in THIS phase. Both rows are decoys for the lock check
     * (`.eq('phase_id', …).eq('status', 'completed')`): one is finished but
     * belongs elsewhere, the other is here but has not been fought.
     */
    const NOTHING_COMPLETED: SupabaseRow[] = [
      { id: 'match-scheduled', phase_id: 'phase-1', status: 'scheduled' },
      { id: 'match-elsewhere', phase_id: 'phase-9', status: 'completed' },
    ];

    it('persists grandFinalReset to config_json when no matches have completed', async () => {
      const { service, supabase } = makeService({
        phases: { rows: bracketPhases({ bracketSize: 8, grandFinalReset: false }) },
        matches: { rows: NOTHING_COMPLETED },
        audit_log: { rows: [] },
      });

      const result = await service.editBracketConfig('phase-1', 'actor-1', {
        grandFinalReset: true,
      });

      expect(writesTo(supabase, 'phases')[0]?.row).toMatchObject({
        config_json: expect.objectContaining({ grandFinalReset: true }),
      });
      expect(result).toMatchObject({ id: 'phase-1' });
    });

    it('refuses the edit when at least one match has completed', async () => {
      const { service } = makeService({
        phases: { rows: bracketPhases({}) },
        matches: { rows: [{ id: 'match-final', phase_id: 'phase-1', status: 'completed' }] },
      });

      await expect(
        service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects grandFinalReset edits on single-elim brackets', async () => {
      const { service } = makeService({
        phases: { rows: bracketPhases({}, 'single_elim') },
        matches: { rows: NOTHING_COMPLETED },
      });

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
      const { service } = makeService({
        phases: { rows: bracketPhases({ bracketSize: 8, wbRounds: 3, lbRounds: 4 }) },
        matches: { rows: NOTHING_COMPLETED },
      });

      await expect(service.editBracketConfig('phase-1', 'actor-1', dto)).rejects.toThrow(
        /Regenerate the bracket/,
      );
    });

    it('allows re-sending a structural value that is already stored', async () => {
      // Not a change, so not a rebuild — the form posts the whole podium struct.
      const { service } = makeService({
        phases: { rows: bracketPhases({ bracketSize: 8, secondChanceTarget: 'gold' }) },
        matches: { rows: NOTHING_COMPLETED },
        audit_log: { rows: [] },
      });

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
    /**
     * Two rows that are NOT this phase's reset slot: a round-8 grand final that
     * belongs here, and a round-9 reset that belongs to another bracket. The
     * "does one already exist?" lookup has to skip both, or the insert below is
     * silently skipped and the flag goes on lying.
     */
    const NOT_THE_RESET_SLOT: SupabaseRow[] = [
      { id: 'slot-gf', phase_id: 'phase-1', round: 8, position: 1 },
      { id: 'slot-reset-elsewhere', phase_id: 'phase-9', round: 9, position: 1 },
    ];

    it('creates the reset slot when the option is turned on after generation', async () => {
      const { service, supabase } = makeService({
        phases: {
          rows: bracketPhases({
            bracketSize: 8,
            fighterCount: 8,
            wbRounds: 3,
            lbRounds: 4,
            grandFinalReset: false,
          }),
        },
        matches: { rows: NOTHING_COMPLETED },
        bracket_slots: { rows: NOT_THE_RESET_SLOT },
        audit_log: { rows: [] },
      });

      await service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: true });

      // Round 9 = wbRounds(3) + lbRounds(4) + 2, and the refs must match what
      // the generator emits or advancement silently stalls forever.
      expect(writesTo(supabase, 'bracket_slots')[0]?.row).toMatchObject({
        phase_id: 'phase-1',
        round: 9,
        position: 1,
        source_a_ref: 'loser of GF',
        source_b_ref: 'winner of GF',
      });
    });

    it('drops the reset slot when the option is turned off', async () => {
      const { service, supabase } = makeService({
        phases: {
          rows: bracketPhases({ bracketSize: 8, wbRounds: 3, lbRounds: 4, grandFinalReset: true }),
        },
        matches: { rows: NOTHING_COMPLETED },
        bracket_slots: { rows: NOT_THE_RESET_SLOT },
        audit_log: { rows: [] },
      });

      await service.editBracketConfig('phase-1', 'actor-1', { grandFinalReset: false });

      // Both halves of the scope. Round alone would delete another bracket's
      // reset; phase alone would delete this bracket's every slot.
      const [dropped] = writesTo(supabase, 'bracket_slots');
      expect(dropped?.op).toBe('delete');
      expect(scopedTo(dropped, 'phase_id')).toBe('phase-1');
      expect(scopedTo(dropped, 'round')).toBe(9);
    });
  });

  describe('reseedBracketRoundOne', () => {
    const RESEED_PHASE: SupabaseRow = {
      id: 'phase-1',
      type: 'single_elim',
      tournament_id: 'tournament-1',
      visibility_status: 'hidden',
      tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
      config_json: {},
    };

    /**
     * Two slots the R1 read must not pick up: one in another bracket, one in a
     * later round of this one. With both filters in place nothing comes back,
     * which is what the four tests below want — and dropping either sends the
     * re-seed on into `matches`, a table none of them seeds.
     */
    const NOT_R1_SLOTS: SupabaseRow[] = [
      { id: 'slot-elsewhere', phase_id: 'phase-9', round: 1, position: 1 },
      { id: 'slot-later-round', phase_id: 'phase-1', round: 5, position: 1 },
    ];

    /**
     * One service for the re-seed path.
     *
     * The old shape dispatched `from` by name inside a `mockImplementation` and
     * fed `phases` two ordered `maybeSingle` answers, because
     * getPhaseForVisibility and the config_json read hit the same table. A
     * seeded row carries both column sets at once, so the ordering goes away.
     */
    const reseedService = (registrations: SupabaseRow[]) =>
      makeService({
        phases: { rows: [RESEED_PHASE] },
        bracket_slots: { rows: NOT_R1_SLOTS },
        // CANNED, not seeded. This read ends
        // `.order('seed', { ascending: true, nullsFirst: false })`, and the
        // double refuses an order option it does not model rather than guess
        // where nulls go — a wrong guess silently reorders a draw. Its filters
        // are not what these tests are about; the projection and the persisted
        // seed are.
        registrations: { data: registrations, error: null },
        tournaments: { rows: [{ id: 'tournament-1' }] },
        audit_log: { rows: [] },
      });

    const SEEDED_REGS: SupabaseRow[] = [
      { id: 'r1', seed: 1, bib_number: null, tournament_id: 'tournament-1', status: 'registered' },
      { id: 'r2', seed: 2, bib_number: null, tournament_id: 'tournament-1', status: 'registered' },
    ];

    it('persists a reproducible PRNG seed for a random reseed', async () => {
      const { service, supabase } = reseedService(SEEDED_REGS);

      await service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'random' });

      const stamped = writesTo(supabase, 'phases').at(-1);
      const updateArg = stamped?.row as { config_json: Record<string, unknown> };
      expect(updateArg.config_json['seedingStrategy']).toBe('random');
      // Without a stored seed the draw could never be replayed after a dispute.
      expect(typeof updateArg.config_json['seedingRandomSeed']).toBe('number');
      // And it lands on this phase only — an unscoped config_json write would
      // stamp one tournament's draw strategy onto every bracket there is.
      expect(scopedTo(stamped, 'id')).toBe('phase-1');
    });

    it('reads registrations with the rating embed only for by-rating', async () => {
      const rated = reseedService(SEEDED_REGS);
      await rated.service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-rating' });
      expect(selectsFor(rated.supabase.from, 'registrations')).toEqual([
        'id, seed, bib_number, persons(global_persons(hema_ratings_id))',
      ]);

      const plain = reseedService(SEEDED_REGS);
      await plain.service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'snake' });
      expect(selectsFor(plain.supabase.from, 'registrations')).toEqual(['id, seed, bib_number']);
    });

    it('refuses by-pool-rank rather than silently falling back to registration seed', async () => {
      // This service instance has no PoolStandingsService, which stands in for
      // "no pool results to seed from". The whole point of the strategy is that
      // it fails loudly instead of degrading to seed order.
      const { service } = reseedService(SEEDED_REGS);

      await expect(
        service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-pool-rank' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses when any R1 match has started', async () => {
      const { service } = makeService({
        phases: { rows: [RESEED_PHASE] },
        bracket_slots: {
          rows: [
            {
              id: 'slot-1',
              phase_id: 'phase-1',
              round: 1,
              position: 1,
              registration_a_id: 'r1',
              registration_b_id: 'r8',
            },
            ...NOT_R1_SLOTS,
          ],
        },
        // Only the running bout blocks. A scheduled one is what a fresh bracket
        // looks like and a voided one never happened, so both are excluded by
        // the two `.not(...)` filters — and the assertion names the id list
        // exactly, so either slipping shows up.
        matches: {
          rows: [
            { id: 'match-running', bracket_slot_id: 'slot-1', status: 'running' },
            { id: 'match-waiting', bracket_slot_id: 'slot-1', status: 'scheduled' },
            { id: 'match-cancelled', bracket_slot_id: 'slot-1', status: 'voided' },
            { id: 'match-other-slot', bracket_slot_id: 'slot-elsewhere', status: 'running' },
          ],
        },
      });

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
    const bracketPhaseRow: SupabaseRow = {
      id: 'phase-1',
      tournament_id: 't1',
      type: 'single_elim',
      visibility_status: 'hidden',
      tournaments: { event_id: 'evt-1', events: { organization_id: 'org-1' } },
    };

    /** Another organisation's bracket, in front of it in the same table. */
    const otherPhaseRow: SupabaseRow = {
      id: 'phase-elsewhere',
      tournament_id: 't9',
      type: 'single_elim',
      visibility_status: 'hidden',
      tournaments: { event_id: 'evt-9', events: { organization_id: 'org-elsewhere' } },
    };

    it('deletes the phase row and leaves the assignment cleanup to the FK', async () => {
      // This used to hand-delete referee_assignments first, on the stated
      // grounds that ON DELETE SET NULL "would leave dangling rows". It would
      // not — it ABORTED, because referee_assignments_scope_check forbids a
      // null match_id at scope_type='match'. Migration 0179 makes the FK
      // CASCADE, which is the only action that agrees with that CHECK, and
      // this path stops being the one delete site in nine that got it right.
      const { service, supabase } = makeService({
        phases: { rows: [otherPhaseRow, bracketPhaseRow] },
        matches: {
          rows: [
            { id: 'match-a', phase_id: 'phase-1' },
            { id: 'match-b', phase_id: 'phase-1' },
            { id: 'match-elsewhere', phase_id: 'phase-elsewhere' },
          ],
        },
        audit_log: { rows: [] },
      });

      await service.deleteBracketPhase('phase-1', 'actor-1');

      expect(mockOrgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'actor-1', 'admin');
      const [dropped] = writesTo(supabase, 'phases');
      expect(dropped?.op).toBe('delete');
      expect(scopedTo(dropped, 'id')).toBe('phase-1');
      // The matches read survives ONLY to count them for the audit trail — and
      // the count is exact, so the third bout must stay out of it.
      expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
        payload_json: expect.objectContaining({ matchCount: 2 }),
      });
      expect(queriedTables(supabase.from)).not.toContain('referee_assignments');
    });

    it('still deletes a phase that has no matches', async () => {
      const { service, supabase } = makeService({
        phases: { rows: [bracketPhaseRow] },
        matches: { rows: [] },
        audit_log: { rows: [] },
      });

      await service.deleteBracketPhase('phase-1', 'actor-1');

      expect(writesTo(supabase, 'phases')[0]?.op).toBe('delete');
    });

    it('rejects pool-type phases with a steering message', async () => {
      const { service } = makeService({
        // The bracket phase sits in front of the pool one: drop
        // `.eq('id', phaseId)` and the wrong phase is deleted outright.
        phases: {
          rows: [
            bracketPhaseRow,
            {
              id: 'phase-pool',
              tournament_id: 't1',
              type: 'pool',
              visibility_status: 'hidden',
              tournaments: { event_id: 'evt-1', events: { organization_id: 'org-1' } },
            },
          ],
        },
      });

      await expect(service.deleteBracketPhase('phase-pool', 'actor-1')).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('pool phases'),
      });
    });

    it('propagates ForbiddenException when actor lacks admin role', async () => {
      const { service } = makeService({ phases: { rows: [bracketPhaseRow] } });

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

    /**
     * The printed piste sheet lists a day's bouts with no times on it, which is
     * the one thing a piste sheet is for. `matches.scheduled_at` was simply
     * never threaded through the slot map — the read is already there, so this
     * is a column, not a second fetch.
     */
    it('carries the planned start through the slot map, null when there is no bout', async () => {
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
          {
            id: 's-empty',
            round: 0,
            position: 1,
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
            id: 'm-1',
            bracket_slot_id: 's-1',
            status: 'scheduled',
            red_score: null,
            blue_score: null,
            winner_registration_id: null,
            lice_id: null,
            scheduled_at: '2026-06-06T09:05:00.000Z',
          },
        ],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(phaseChain())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(matchesChain)
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));

      const result = await service.getTournamentBracket('tournament-1');
      const slots = result!.slots as Array<Record<string, unknown>>;

      expect(slots.find((s) => s['id'] === 's-1')?.['scheduledAt']).toBe(
        '2026-06-06T09:05:00.000Z',
      );
      // A slot with no bout yet has no time, and must not borrow another's.
      expect(slots.find((s) => s['id'] === 's-empty')?.['scheduledAt']).toBeNull();
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

    /**
     * `scheduled_at` has been a column of `vw_tournament_query_matches` since
     * migration 0164 and was simply missing from the select string, so the
     * printed piste sheet had no times on it. One column, no view change and no
     * second fetch — which is what keeps the print pack's one-source-per-pack
     * rule intact.
     */
    it('carries the planned start on each pool match, null for an unscheduled one', async () => {
      // The SELECT STRING is asserted, not just the projected value. These
      // mocks answer with whatever the fixture holds regardless of what was
      // asked for, so dropping `scheduled_at` from the select alone would leave
      // this test green while the real read returned nothing — the column was
      // missing from that string for two years exactly this quietly.
      let viewSelect = '';
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
          const base = {
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
            status: 'scheduled',
          };
          const chain = makeChain({ data: null, error: null });
          chain.select.mockImplementation((cols: string) => {
            viewSelect = cols;
            return chain;
          });
          chain.order.mockResolvedValue({
            data: [
              {
                ...base,
                match_id: 'm-1',
                match_number_label: 'L1-PA-M1',
                scheduled_at: '2026-06-06T09:05:00.000Z',
              },
              {
                ...base,
                match_id: 'm-2',
                match_number_label: 'L1-PA-M2',
                scheduled_at: null,
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
      const matches = result[0]?.matches as Array<Record<string, unknown>>;

      expect(viewSelect).toContain('scheduled_at');
      expect(matches[0]?.['scheduled_at']).toBe('2026-06-06T09:05:00.000Z');
      // A bout nobody has placed yet has no time. It must arrive as null rather
      // than be dropped, or the sheet cannot list it last.
      expect(matches[1]?.['scheduled_at']).toBeNull();
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

    // Pins the post-0063 embed name. The FK on
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
    it("returns only the narrow score+winner shape for a tournament's matches", async () => {
      // Rows carry the `phases` embed the query has to ask for, because there
      // is no matches.tournament_id — the embed is the ONLY way to filter by
      // tournament, and it must not reach the caller.
      const rows = [
        {
          id: 'm-1',
          status: 'completed',
          red_score: 5,
          blue_score: 3,
          winner_registration_id: 'reg-blue',
          phases: { tournament_id: 'tournament-1' },
        },
        {
          id: 'm-2',
          status: 'pending',
          red_score: null,
          blue_score: null,
          winner_registration_id: null,
          phases: { tournament_id: 'tournament-1' },
        },
      ];
      const matchesChain = makeChain({ data: rows, error: null });
      // The chain resolves when awaited after `.eq(...)`; mirror the
      // pattern used by listPoolsWithMatches's data selects.
      matchesChain.eq.mockResolvedValue({ data: rows, error: null });
      fromMock.mockReturnValueOnce(matchesChain);

      const result = await service.listMatchScores('tournament-1');

      // The winner rides along with the scores: the Matches tab bolds the
      // RECORDED winner, which a forfeit or a referee_decision override can put
      // on the lower score, so a scores-only poll re-staled every correction.
      expect(result).toEqual([
        {
          id: 'm-1',
          status: 'completed',
          red_score: 5,
          blue_score: 3,
          winner_registration_id: 'reg-blue',
        },
        {
          id: 'm-2',
          status: 'pending',
          red_score: null,
          blue_score: null,
          winner_registration_id: null,
        },
      ]);
      // The SELECT must NOT include privileged fields like referee_id
      // or lice_id — those should only come through the heavier
      // `pools-with-matches` endpoint that handles permissions properly.
      expect(matchesChain.select).toHaveBeenCalledWith(
        'id, status, red_score, blue_score, winner_registration_id, phases!inner(tournament_id)',
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
      // Bulk update: matches.update({lice_id}).eq('pool_id', poolId).select('id')
      // — the ids come back from the write so the alerts can be refreshed.
      const updateChain = makeChain({ data: null, error: null });
      updateChain.select.mockResolvedValue({ data: [{ id: 'match-1' }], error: null });

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
      updateChain.select.mockResolvedValue({ data: [{ id: 'match-1' }], error: null });

      fromMock
        .mockReturnValueOnce(poolCtxChain)
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.setPoolLice('pool-1', null, 'user-1');

      expect(updateChain.update).toHaveBeenCalledWith({ lice_id: null });
      expect(result).toEqual({ poolId: 'pool-1', liceId: null });
    });

    /**
     * The clock does not move here — only the piste. A queued alert names the
     * piste in its own sentence and freezes it at enqueue, so a piste-only move
     * leaves the alert sending a competitor to a piste this pool has left, at
     * exactly the right minute. Nothing about that looks broken, which is why
     * `lice_id` writes went years without telling the queue anything.
     */
    it('re-queues the alerts for every match it re-pisted', async () => {
      const matchAlerts = { refresh: vi.fn().mockResolvedValue(undefined) };
      const svc = new PhasesService(
        legacyClient as never,
        undefined,
        mockOrgs as never,
        undefined,
        undefined,
        undefined,
        undefined,
        matchAlerts as never,
      );

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
      updateChain.select.mockResolvedValue({
        data: [{ id: 'match-1' }, { id: 'match-2' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(poolCtxChain)
        .mockReturnValueOnce(editableChain)
        .mockReturnValueOnce(updateChain);

      await svc.setPoolLice('pool-1', 'lice-9', 'user-1');

      // The ids come from the write's own RETURNING, so the projection is part
      // of the contract: drop `.select('id')` and there is nothing to refresh.
      expect(updateChain.select).toHaveBeenCalledWith('id');
      expect(matchAlerts.refresh).toHaveBeenCalledWith(['match-1', 'match-2']);
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

      const svc = new PhasesService(legacyClient as never, undefined, mockOrgs as never);
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
        legacyClient as never,
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
        legacyClient as never,
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
        legacyClient as never,
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

// ── getTournamentBracket — seeding drift ─────────────────────────────────────

/**
 * Most of the time the app heals itself: reopen a pool bout, replay it, and the
 * auto-hook re-seeds the bracket. It only gets STUCK when a first-round bracket
 * bout has already started — then re-seeding is refused and nobody is told, so
 * the bracket quietly disagrees with the standings it claims to come from.
 *
 * FOUR states, not a boolean. `pending → fresh` (healed) and `pending → stale`
 * (refused) are the transition this exists to make visible; a boolean would
 * paint both red.
 *
 * Mocks dispatch on TABLE NAME — this read makes a long, conditional sequence
 * of `from()` calls and an order-based chain desyncs the moment one is added.
 */
describe('PhasesService.getTournamentBracket — seeding drift', () => {
  const FOUR_SEEDED_SLOTS = [
    {
      id: 's1',
      round: 1,
      position: 1,
      source_a_type: 'seed',
      source_a_ref: 'seed 1',
      source_b_type: 'seed',
      source_b_ref: 'seed 4',
      registration_a_id: 'r1',
      registration_b_id: 'r4',
    },
    {
      id: 's2',
      round: 1,
      position: 2,
      source_a_type: 'seed',
      source_a_ref: 'seed 3',
      source_b_type: 'seed',
      source_b_ref: 'seed 2',
      registration_a_id: 'r3',
      registration_b_id: 'r2',
    },
  ];
  const COMPLETED_POOLS = [
    {
      poolId: 'p1',
      poolName: 'Pool 1',
      status: 'completed',
      rows: [{ rank: 1, registrationId: 'r1' }],
    },
  ];
  const OVERALL_ROWS = [
    { rank: 1, registrationId: 'r1' },
    { rank: 2, registrationId: 'r2' },
    { rank: 3, registrationId: 'r3' },
    { rank: 4, registrationId: 'r4' },
  ];

  function buildService(input: {
    strategy?: string;
    poolPhaseExists?: boolean;
    perPool?: unknown[];
    overallRows?: Array<{ rank: number; registrationId: string }>;
    slots: unknown[];
    matches?: Array<{ id: string; bracket_slot_id: string; status: string }>;
    swiss?: {
      phaseId: string | null;
      roundCount: number;
      roundsCompleted: number;
      finalized?: boolean;
      rows: Array<{ rank: number; registrationId: string; displayName: string }>;
    };
  }) {
    fromMock.mockImplementation((table: string) => {
      switch (table) {
        case 'phases': {
          // Both the bracket-phase lookup and computePoolGate's pool lookup
          // land here; the pool one is the only caller filtering type='pool'.
          const chain = makeChain({ data: null, error: null });
          let poolLookup = false;
          chain.eq.mockImplementation((column: string, value: string) => {
            if (column === 'type' && value === 'pool') poolLookup = true;
            return chain;
          });
          chain.maybeSingle.mockImplementation(() =>
            Promise.resolve({
              data: poolLookup
                ? (input.poolPhaseExists ?? true)
                  ? { id: 'pool-phase-1' }
                  : null
                : {
                    id: 'phase-1',
                    type: 'single_elim',
                    visibility_status: 'published',
                    config_json: {
                      bracketSize: 4,
                      seedingStrategy: input.strategy ?? 'snake',
                    },
                  },
              error: null,
            }),
          );
          return chain;
        }
        case 'bracket_slots':
          return makeAwaitableChain({ data: input.slots, error: null });
        case 'matches':
          return makeAwaitableChain({ data: input.matches ?? [], error: null });
        default:
          return makeAwaitableChain({ data: [], error: null });
      }
    });

    const poolStandings = {
      getPoolStandings: vi
        .fn()
        .mockImplementation((_id: string, mode: 'by-pool' | 'overall') =>
          Promise.resolve(
            mode === 'overall'
              ? { rows: input.overallRows ?? OVERALL_ROWS }
              : { pools: input.perPool ?? COMPLETED_POOLS },
          ),
        ),
    };
    const swissStandings = input.swiss
      ? { getSwissStandings: vi.fn().mockResolvedValue(input.swiss) }
      : undefined;
    return new PhasesService(
      legacyClient as never,
      undefined,
      mockOrgs as never,
      undefined,
      undefined,
      poolStandings as never,
      swissStandings as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
  });

  it('reports fresh when the slots still hold what the standings would put there', async () => {
    const service = buildService({ slots: FOUR_SEEDED_SLOTS });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toEqual({
      state: 'fresh',
      source: 'pool-standings',
      changedSlotIds: [],
      blockingMatchIds: [],
    });
  });

  it('reports stale and names the started match that blocks the re-seed', async () => {
    // The whole reason this exists: the auto-hook refuses to re-seed once an R1
    // bout has started, and until now nobody was told. The blocking id is what
    // lets the UI offer the CHEAP remedy — reset that one match and the next
    // pool completion heals the bracket for free.
    const service = buildService({
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
      matches: [{ id: 'm1', bracket_slot_id: 's1', status: 'running' }],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toMatchObject({
      state: 'stale',
      source: 'pool-standings',
      changedSlotIds: ['s2'],
      blockingMatchIds: ['m1'],
    });
  });

  it('reports pending while a pool bout is back in play', async () => {
    // The source is not final, so there is no plan to diff yet — and the
    // bracket is about to heal itself. Showing "stale" here would send the
    // organiser to Regenerate for a bracket that needs nothing done to it.
    const service = buildService({
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
      perPool: [{ poolId: 'p1', poolName: 'Pool 1', status: 'running', rows: [] }],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toMatchObject({ state: 'pending', changedSlotIds: [] });
  });

  it('reports not-applicable for a draw that is not seeded from results', async () => {
    // `random` re-shuffles the entire draw whenever anyone withdraws, so the
    // recomputed plan differs from a perfectly correct bracket. Diffing it
    // would put a warning on every random bracket after any roster edit.
    const service = buildService({
      strategy: 'random',
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toEqual({
      state: 'not-applicable',
      source: null,
      changedSlotIds: [],
      blockingMatchIds: [],
    });
  });

  it('reports not-applicable for a straight-to-bracket tournament', async () => {
    // No pool phase → populate falls through to registration seed, which
    // reshuffles on any withdrawal just as random does.
    const service = buildService({
      poolPhaseExists: false,
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift.state).toBe('not-applicable');
  });

  it('does not report a play-in bracket as permanently stale', async () => {
    // Side B waits on `winner of R0P1` and is filled by ADVANCEMENT, not by
    // seeding. Comparing it against the plan's null would make every play-in
    // bracket read stale from the moment its first qualifier came through.
    const service = buildService({
      slots: [
        {
          id: 's1',
          round: 1,
          position: 1,
          source_a_type: 'seed',
          source_a_ref: 'seed 1',
          source_b_type: 'winner_of',
          source_b_ref: 'winner of R0P1',
          registration_a_id: 'r1',
          registration_b_id: 'r7',
        },
      ],
      overallRows: [{ rank: 1, registrationId: 'r1' }],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift.state).toBe('fresh');
  });

  it('reports pending while the Swiss phase it seeds from is still running', async () => {
    // `rankFromSwiss` REFUSES an unfinished phase with a 400. A read must not
    // turn a mid-event snapshot into an error, and "not final yet" is exactly
    // what the organiser needs to see — so finality is asked before resolving.
    const service = buildService({
      strategy: 'by-swiss-rank',
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
      swiss: { phaseId: 'swiss-1', roundCount: 5, roundsCompleted: 3, rows: [] },
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toMatchObject({
      state: 'pending',
      source: 'swiss-standings',
      changedSlotIds: [],
    });
  });

  it('diffs against a FINISHED Swiss phase', async () => {
    const service = buildService({
      strategy: 'by-swiss-rank',
      slots: [FOUR_SEEDED_SLOTS[0], { ...FOUR_SEEDED_SLOTS[1], registration_a_id: 'r9' }],
      swiss: {
        phaseId: 'swiss-1',
        roundCount: 4,
        roundsCompleted: 4,
        rows: [
          { rank: 1, registrationId: 'r1', displayName: 'One' },
          { rank: 2, registrationId: 'r2', displayName: 'Two' },
          { rank: 3, registrationId: 'r3', displayName: 'Three' },
          { rank: 4, registrationId: 'r4', displayName: 'Four' },
        ],
      },
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift).toMatchObject({
      state: 'stale',
      source: 'swiss-standings',
      changedSlotIds: ['s2'],
    });
  });

  it('reports not-applicable when no slot carries a seed label at all', async () => {
    // An ungenerated bracket, or one whose first round is entirely fed by
    // advancement. Nothing to compare, so nothing to warn about.
    const service = buildService({
      slots: [
        {
          id: 's1',
          round: 2,
          position: 1,
          source_a_type: 'winner_of',
          source_a_ref: 'winner of R1P1',
          source_b_type: 'winner_of',
          source_b_ref: 'winner of R1P2',
          registration_a_id: null,
          registration_b_id: null,
        },
      ],
    });

    const result = await service.getTournamentBracket('tournament-1');

    expect(result!.seedingDrift.state).toBe('not-applicable');
  });
});
