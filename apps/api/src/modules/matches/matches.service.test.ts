import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

/**
 * The positional double the write-path tests still use.
 *
 * Renamed off `mockSupabase` so it stops shadowing the shared export replacing
 * it — same name, different semantics, in 54 files across the repo. It goes
 * entirely once the write paths move too.
 */
const fromMock = vi.fn();
const legacySupabase = { service: { from: fromMock }, anon: {} };
const mockScoring = {
  recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
};
/**
 * The service no longer injects the two schedulers directly. Every write of a
 * match time goes through the refresher, which owns calling both — see
 * `match-alert-refresher.service.ts` for why one call replaced two.
 */
const mockMatchAlerts = {
  refresh: vi.fn().mockResolvedValue(undefined),
};
const mockFrozenResults = {
  assertExchangeCreationAllowed: vi.fn().mockResolvedValue(undefined),
  guardExchangeMutation: vi.fn().mockResolvedValue(null),
};

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    gte: vi.fn() as ReturnType<typeof vi.fn>,
    lt: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  return chain;
}

/**
 * One service over a Supabase double that routes by TABLE NAME, built per test.
 *
 * The shape it replaces reprogrammed a single module-level `fromMock` per test
 * with `mockReturnValueOnce` chains, so every answer was positional: insert one
 * `from()` call anywhere in a method and every later answer shifted by one while
 * the suite stayed green. A seed per table is what removes that coupling.
 */
function makeService(seed: Record<string, TableSeed>, opts?: { frozen?: boolean }) {
  const supabase = mockSupabase(seed);
  const service = new MatchesService(
    supabase as never,
    mockScoring as never,
    mockMatchAlerts as never,
    opts?.frozen ? (mockFrozenResults as never) : undefined,
  );
  return { service, supabase };
}

/**
 * Everything `getMatchSummary` reads for one bout.
 *
 * Nine tables, not the three the old fixture named. `events`,
 * `referee_assignments` and the two `matches` reads were all answered by a
 * blanket `{ data: null }` fallback that no one chose — the shared double throws
 * on an undeclared table, which is how this became the real surface.
 *
 * `matches.lice_id` is null on purpose: a piste id here would send the summary
 * on to `lices`, and that table would then have to be declared too.
 * `referee_assignments: []` short-circuits `referee_skills` the same way.
 */
const summarySeed = (
  view: Record<string, unknown>,
  extra: Record<string, TableSeed> = {},
): Record<string, TableSeed> => ({
  vw_tournament_query_matches: { rows: [view] },
  tournaments: { rows: [{ id: 't1', weapon: 'longsword' }] },
  events: { rows: [{ id: 'event-1', timezone: 'UTC' }] },
  matches: { rows: [{ id: view['match_id'], lice_id: null }] },
  referee_assignments: { rows: [] },
  ...extra,
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MatchesService', () => {
  let service: MatchesService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new MatchesService(
      legacySupabase as never,
      mockScoring as never,
      mockMatchAlerts as never,
    );
  });

  // ── Match summary — canonical roundCode ──────────────────────────────────

  describe('getMatchSummary', () => {
    it('returns roundCode built via the shared helper for a pool match', async () => {
      // The scoreboard used to render `match_number_label` raw, while the
      // pool list re-formatted client-side via formatRoundCode. Same match,
      // two different visible codes. Push the build into the backend so
      // both surfaces render the same `roundCode` field.
      //
      // Fixture: longsword tournament, pool A (sort_order=0 → number 1),
      // match label `L1-PA-M1` → formatRoundCode yields `LSW-P1-M1`
      // (the bare match sequence is pulled from the compound label).
      const { service: summaryService } = makeService(
        summarySeed(
          {
            match_id: 'm1',
            match_number_label: 'L1-PA-M1',
            status: 'scheduled',
            pool_id: 'p1',
            pool_name: 'Pool A',
            bracket_round: null,
            red_name: 'Alice',
            blue_name: 'Bob',
            red_club: 'AAA',
            blue_club: 'BBB',
            tournament_id: 't1',
            event_id: 'event-1',
          },
          { pools: { rows: [{ id: 'p1', sort_order: 0 }] } },
        ),
      );

      const result = (await summaryService.getMatchSummary('m1')) as { roundCode: string };

      expect(result.roundCode).toBe('LSW-P1-M1');
    });

    it('reads bracketSize from phases.config_json so bracket matches render LSW-B-R16-M1', async () => {
      // After stamping match_number_label on bracket matches, the scoreboard
      // had to ALSO fetch the phase's bracketSize to translate
      // bracket_round → R16/QF/SF/F. Without this, the code fell back to
      // B{round} and diverged from the bracket-card label.
      const { service: summaryService } = makeService(
        summarySeed(
          {
            match_id: 'm-r16-1',
            match_number_label: '1',
            status: 'scheduled',
            pool_id: null,
            pool_name: null,
            bracket_round: 1,
            red_name: 'Alice',
            blue_name: 'Bob',
            red_club: null,
            blue_club: null,
            tournament_id: 't1',
            event_id: 'event-1',
            phase_id: 'phase-1',
          },
          { phases: { rows: [{ id: 'phase-1', config_json: { bracketSize: 16 } }] } },
        ),
      );

      const result = (await summaryService.getMatchSummary('m-r16-1')) as { roundCode: string };

      expect(result.roundCode).toBe('LSW-B-R16-M1');
    });
  });

  // listExchanges returns raw snake_case from Supabase, but the scoring
  // pad's ExchangeRow type is camelCase (occurredAt/scoringSide/
  // scoreDelta) and the timeline reads clockTimeMs. Map the row so the
  // FE renders fighter, delta and match-clock time on exchange rows.
  describe('listExchanges — camelCase mapping', () => {
    const RAW_ROW = {
      id: 'ex-1',
      match_id: 'm1',
      sequence: 1,
      type: 'clean',
      voided: false,
      occurred_at: '2026-05-05T10:00:00.000Z',
      clock_time_ms: 90_000,
      first_striker_color: 'red',
      red_score_delta: 2,
      blue_score_delta: 0,
      afterblow_value: null,
    };

    it('maps a raw clean/red row to scoringSide + scoreDelta + clockTimeMs', async () => {
      const { service: listService } = makeService({ exchanges: { rows: [RAW_ROW] } });

      const result = (await listService.listExchanges('m1')) as Array<Record<string, unknown>>;

      expect(result[0]).toMatchObject({
        id: 'ex-1',
        occurredAt: '2026-05-05T10:00:00.000Z',
        clockTimeMs: 90_000,
        scoringSide: 'red',
        scoreDelta: 2,
      });
    });

    /**
     * The timeline renders these in the order they arrive, and a bout replays
     * from them. Seeded out of order because the old canned chain answered with
     * whatever the fixture held whatever was asked — so `.order('sequence')`
     * could have been reversed, or absent, with nothing to say so.
     */
    it('returns the exchanges in sequence order, not in fixture order', async () => {
      const { service: listService } = makeService({
        exchanges: {
          rows: [
            { ...RAW_ROW, id: 'ex-3', sequence: 3 },
            { ...RAW_ROW, id: 'ex-1', sequence: 1 },
            { ...RAW_ROW, id: 'ex-2', sequence: 2 },
          ],
        },
      });

      const result = (await listService.listExchanges('m1')) as Array<Record<string, unknown>>;

      expect(result.map((row) => row['id'])).toEqual(['ex-1', 'ex-2', 'ex-3']);
    });

    it('reads only the exchanges of the bout it was asked for', async () => {
      const { service: listService } = makeService({
        exchanges: {
          rows: [RAW_ROW, { ...RAW_ROW, id: 'other-bout', match_id: 'm2', sequence: 1 }],
        },
      });

      const result = (await listService.listExchanges('m1')) as Array<Record<string, unknown>>;

      expect(result.map((row) => row['id'])).toEqual(['ex-1']);
    });
  });

  // ── Idempotency on client_uuid ────────────────────────────────────────────

  describe('createExchange — idempotency', () => {
    it('returns existing exchange when client_uuid already exists (no duplicate insert)', async () => {
      const existingExchange = { id: 'ex-1', client_uuid: 'uuid-abc', match_id: 'm1', sequence: 1 };

      // First call: client_uuid check returns existing
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: existingExchange, error: null });
      fromMock.mockReturnValue(checkChain);

      const result = await service.createExchange('m1', {
        clientUuid: 'uuid-abc',
        sequence: 1,
        type: 'clean',
        occurredAt: new Date().toISOString(),
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
      });

      // Returns existing without calling insert
      expect((result as { id: string }).id).toBe('ex-1');
      // Score should NOT be recomputed for duplicate
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });

    it('inserts new exchange when client_uuid is fresh', async () => {
      const newExchange = { id: 'ex-new', client_uuid: 'uuid-new', match_id: 'm1', sequence: 2 };

      // client_uuid check: not found
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      // round state: single round, not awaiting
      const roundChain = makeChain({
        data: { current_round: 1, awaiting_round_advance: false },
        error: null,
      });

      // insert: success
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: newExchange, error: null });

      fromMock
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(roundChain)
        .mockReturnValueOnce(insertChain);

      const result = await service.createExchange('m1', {
        clientUuid: 'uuid-new',
        sequence: 2,
        type: 'clean',
        occurredAt: new Date().toISOString(),
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
      });

      expect((result as { id: string }).id).toBe('ex-new');
      // Score IS recomputed after new insert
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    });

    it('appends at the server next sequence when a stale pad sequence collides', async () => {
      // A pad whose local counter reset (mid-match reload / device swap) POSTs
      // sequence 1 while the server already holds 1..12. The offline outbox
      // treats 400 as a TERMINAL drop, so createExchange must append instead
      // of rejecting: retry with the server's max(sequence)+1.
      const appended = { id: 'ex-13', client_uuid: 'uuid-stale', match_id: 'm1', sequence: 13 };

      const checkChain = makeChain({ data: null, error: null }); // client_uuid fresh
      const roundChain = makeChain({
        data: { current_round: 1, awaiting_round_advance: false },
        error: null,
      });
      const collidingInsert = makeChain({ data: null, error: null });
      collidingInsert.single.mockResolvedValue({
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "exchanges_match_id_sequence"',
        },
      });
      const raceChain = makeChain({ data: null, error: null }); // still not a client_uuid dup
      const maxSeqChain = makeChain({ data: { sequence: 12 }, error: null });
      const retryInsert = makeChain({ data: null, error: null });
      retryInsert.single.mockResolvedValue({ data: appended, error: null });

      fromMock
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(roundChain)
        .mockReturnValueOnce(collidingInsert)
        .mockReturnValueOnce(raceChain)
        .mockReturnValueOnce(maxSeqChain)
        .mockReturnValueOnce(retryInsert);

      const result = await service.createExchange('m1', {
        clientUuid: 'uuid-stale',
        sequence: 1,
        type: 'clean',
        occurredAt: new Date().toISOString(),
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
      });

      expect((result as { sequence: number }).sequence).toBe(13);
      expect(retryInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ sequence: 13 }));
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    });

    it('rejects new exchange creation when event results are frozen', async () => {
      service = new MatchesService(
        legacySupabase as never,
        mockScoring as never,
        mockMatchAlerts as never,
        mockFrozenResults as never,
      );
      mockFrozenResults.assertExchangeCreationAllowed.mockRejectedValueOnce(
        new BadRequestException('Event results are frozen'),
      );

      await expect(
        service.createExchange(
          'm1',
          {
            clientUuid: 'uuid-new',
            sequence: 2,
            type: 'clean',
            occurredAt: new Date().toISOString(),
            firstStrikerColor: 'red',
            firstStrikeValue: 1,
          },
          { userId: 'organizer-1' },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(fromMock).not.toHaveBeenCalled();
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });
  });

  // The exchange row stores the referee's RAW button values; the materialized
  // red/blue_score_delta apply the tournament's afterblow mode. Deductive
  // subtracts the afterblow from the attacker (defender nets 0).
  describe('createExchange — afterblow mode netting', () => {
    async function recordAfterblow(
      afterblowMode: 'full' | 'deductive',
      firstStrikerColor: 'red' | 'blue',
    ) {
      const checkChain = makeChain({ data: null, error: null }); // idempotency: fresh
      const modeChain = makeChain({
        data: { phases: { tournaments: { scoring_config_json: { afterblowMode } } } },
        error: null,
      });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: { id: 'ex-ab' }, error: null });
      const roundChain = makeChain({
        data: { current_round: 1, awaiting_round_advance: false },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(checkChain) // exchanges — idempotency check
        .mockReturnValueOnce(roundChain) // matches — round state (round_number + gate)
        .mockReturnValueOnce(modeChain) // matches — getAfterblowMode
        .mockReturnValueOnce(insertChain); // exchanges — insert

      await service.createExchange('m1', {
        clientUuid: 'uuid-ab',
        sequence: 3,
        type: 'afterblow',
        occurredAt: new Date().toISOString(),
        firstStrikerColor,
        firstStrikeValue: 2,
        afterblowValue: 1,
      });

      return insertChain.insert.mock.calls[0]![0] as Record<string, number>;
    }

    it('deductive: stores raw 2/1 but nets attacker +1 / defender 0', async () => {
      const inserted = await recordAfterblow('deductive', 'red');
      // Raw button values preserved for blow-count stats.
      expect(inserted['first_strike_value']).toBe(2);
      expect(inserted['afterblow_value']).toBe(1);
      // Netted: attacker max(0, 2 - 1) = 1, defender 0.
      expect(inserted['red_score_delta']).toBe(1);
      expect(inserted['blue_score_delta']).toBe(0);
    });

    it('full: both fighters keep their points', async () => {
      const inserted = await recordAfterblow('full', 'blue');
      expect(inserted['first_strike_value']).toBe(2);
      expect(inserted['afterblow_value']).toBe(1);
      // blue struck first → blue +2, red (afterblow) +1.
      expect(inserted['blue_score_delta']).toBe(2);
      expect(inserted['red_score_delta']).toBe(1);
    });
  });

  // ── Void never deletes ────────────────────────────────────────────────────

  describe('voidExchange', () => {
    it('sets voided=true, never deletes the row', async () => {
      const exchange = { id: 'ex-1', match_id: 'm1', voided: false };
      const voidedExchange = { id: 'ex-1', match_id: 'm1', voided: true, voided_reason: 'test' };

      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: exchange, error: null });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: voidedExchange, error: null });

      fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

      const result = await service.voidExchange('ex-1', { reason: 'test' });

      expect((result as { voided: boolean }).voided).toBe(true);
      // Score recomputed after void
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    });

    it('throws BadRequestException when exchange is already voided', async () => {
      const voidedExchange = { id: 'ex-1', match_id: 'm1', voided: true };
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: voidedExchange, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.voidExchange('ex-1', {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for nonexistent exchange', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.voidExchange('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('creates a pending review request instead of voiding when event results are frozen', async () => {
      service = new MatchesService(
        legacySupabase as never,
        mockScoring as never,
        mockMatchAlerts as never,
        mockFrozenResults as never,
      );
      const exchange = { id: 'ex-1', match_id: 'm1', voided: false };
      const pending = { pendingReview: true, requestId: 'request-1', status: 'pending' };
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: exchange, error: null });
      fromMock.mockReturnValue(fetchChain);
      mockFrozenResults.guardExchangeMutation.mockResolvedValueOnce(pending);

      const result = await service.voidExchange(
        'ex-1',
        { reason: 'wrong exchange' },
        { userId: 'organizer-1' },
      );

      expect(result).toEqual(pending);
      expect(mockFrozenResults.guardExchangeMutation).toHaveBeenCalledWith({
        exchange,
        requestType: 'void_exchange',
        reason: 'wrong exchange',
        userId: 'organizer-1',
      });
      expect(fetchChain.update).not.toHaveBeenCalled();
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });
  });

  describe('revertVoidExchange', () => {
    it('creates a pending review request instead of reverting when event results are frozen', async () => {
      service = new MatchesService(
        legacySupabase as never,
        mockScoring as never,
        mockMatchAlerts as never,
        mockFrozenResults as never,
      );
      const exchange = { id: 'ex-1', match_id: 'm1', voided: true };
      const pending = { pendingReview: true, requestId: 'request-1', status: 'pending' };
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: exchange, error: null });
      fromMock.mockReturnValue(fetchChain);
      mockFrozenResults.guardExchangeMutation.mockResolvedValueOnce(pending);

      const result = await service.revertVoidExchange('ex-1', { userId: 'organizer-1' });

      expect(result).toEqual(pending);
      expect(mockFrozenResults.guardExchangeMutation).toHaveBeenCalledWith({
        exchange,
        requestType: 'revert_void_exchange',
        reason: null,
        userId: 'organizer-1',
      });
      expect(fetchChain.update).not.toHaveBeenCalled();
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });
  });

  // ── Score recomputation ───────────────────────────────────────────────────

  describe('approveFrozenExchangeEdit', () => {
    it('applies approved void requests without creating another frozen review request', async () => {
      service = new MatchesService(
        legacySupabase as never,
        mockScoring as never,
        mockMatchAlerts as never,
        mockFrozenResults as never,
      );
      const exchange = { id: 'ex-1', match_id: 'm1', voided: false };
      const voidedExchange = { id: 'ex-1', match_id: 'm1', voided: true };
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: exchange, error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: voidedExchange, error: null });
      fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

      await service.approveFrozenExchangeEdit(
        {
          id: 'request-1',
          exchange_id: 'ex-1',
          request_type: 'void_exchange',
          reason: 'approved correction',
        },
        'super-1',
      );

      expect(mockFrozenResults.guardExchangeMutation).not.toHaveBeenCalled();
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    });
  });

  describe('score recomputation', () => {
    it('recomputeMatchScore is called after every new exchange insert', async () => {
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: { id: 'ex-1' }, error: null });
      const roundChain = makeChain({
        data: { current_round: 1, awaiting_round_advance: false },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(roundChain)
        .mockReturnValueOnce(insertChain);

      await service.createExchange('match-1', {
        clientUuid: 'fresh-uuid',
        sequence: 1,
        type: 'double',
        occurredAt: new Date().toISOString(),
      });

      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledOnce();
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('match-1');
    });
  });

  // The scoring pad sends the match-clock position (accumulated active
  // ms) with every exchange so the timeline can render match-clock time
  // instead of wall-clock. The value must land on exchanges.clock_time_ms.
  describe('createExchange — clock time', () => {
    it('persists clock_time_ms from dto.clockTimeMs on the inserted row', async () => {
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: { id: 'ex-1' }, error: null });
      const roundChain = makeChain({
        data: { current_round: 1, awaiting_round_advance: false },
        error: null,
      });
      fromMock
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(roundChain)
        .mockReturnValueOnce(insertChain);

      await service.createExchange('match-1', {
        clientUuid: 'uuid-clock',
        sequence: 1,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 2,
        occurredAt: new Date().toISOString(),
        clockTimeMs: 90_000,
      });

      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ clock_time_ms: 90_000 }),
      );
    });
  });

  // Best-of-N: a new exchange is stamped with the match's current open round,
  // and scoring is blocked between rounds (while awaiting_round_advance).
  describe('createExchange — best-of rounds', () => {
    it('stamps round_number from the match current_round on the inserted row', async () => {
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const roundChain = makeChain({
        data: { current_round: 3, awaiting_round_advance: false },
        error: null,
      });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: { id: 'ex-r3' }, error: null });
      fromMock
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(roundChain)
        .mockReturnValueOnce(insertChain);

      await service.createExchange('match-1', {
        clientUuid: 'uuid-r3',
        sequence: 1,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
        occurredAt: new Date().toISOString(),
      });

      expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ round_number: 3 }));
    });

    it('rejects scoring while a round is awaiting advance', async () => {
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const roundChain = makeChain({
        data: { current_round: 2, awaiting_round_advance: true },
        error: null,
      });
      fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(roundChain);

      await expect(
        service.createExchange('match-1', {
          clientUuid: 'uuid-blocked',
          sequence: 1,
          type: 'clean',
          firstStrikerColor: 'red',
          firstStrikeValue: 1,
          occurredAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });
  });

  describe('scheduleMatch', () => {
    /**
     * The bout being placed, plus whatever already sits on the strip.
     *
     * `match-1` has to be the ONLY row carrying that id: the write ends
     * `.eq('id', 'match-1').select('*').single()`, and a seeded table answers
     * `single()` with a real PGRST116 when the count is not exactly one.
     */
    const piste = (occupants: Array<Record<string, unknown>>): Record<string, TableSeed> => ({
      matches: {
        rows: [
          { id: 'match-1', lice_id: null, scheduled_at: null, status: 'scheduled' },
          ...occupants,
        ],
      },
    });

    const occupant = (over: Record<string, unknown> = {}) => ({
      id: 'other-match',
      lice_id: 'lice-1',
      scheduled_at: '2026-05-02T10:32:00.000Z',
      status: 'scheduled',
      ...over,
    });

    it('reschedules match-starting and follow notifications when scheduled_at changes', async () => {
      // Piste empty → the placement is accepted and the write proceeds.
      const { service: scheduleService } = makeService(piste([]));

      await scheduleService.scheduleMatch('match-1', 'lice-1', '2026-05-02T10:30:00.000Z');

      expect(mockMatchAlerts.refresh).toHaveBeenCalledWith(['match-1']);
    });

    it('refuses a placement that lands on an occupied piste, and writes nothing', async () => {
      // Different tournament, no shared fighter — invisible to the grid's
      // conflict banner, which is why this had to move server-side.
      const { service: scheduleService, supabase } = makeService(piste([occupant()]));

      await expect(
        scheduleService.scheduleMatch('match-1', 'lice-1', '2026-05-02T10:30:00.000Z'),
      ).rejects.toBeInstanceOf(ConflictException);
      // Every table, not one chain: a refusal must leave the whole event alone.
      expect(supabase.writes).toEqual([]);
      expect(mockMatchAlerts.refresh).not.toHaveBeenCalled();
    });

    it('allows a back-to-back placement on the same piste', async () => {
      // Ends at 10:05 exactly (bouts default to five minutes). Touching is not
      // overlapping, or every generated schedule would refuse itself.
      const { service: scheduleService } = makeService(
        piste([occupant({ id: 'earlier', scheduled_at: '2026-05-02T10:00:00.000Z' })]),
      );

      await expect(
        scheduleService.scheduleMatch('match-1', 'lice-1', '2026-05-02T10:05:00.000Z'),
      ).resolves.toBeDefined();
    });

    /**
     * A voided bout keeps its piste and its time on the row. Nothing in
     * `lice-occupancy.ts` knows about status, so `.not('status','eq','voided')`
     * on the read is the only thing stopping a cancelled bout from blocking the
     * strip for the rest of the day — and the canned double answered with the
     * fixture whatever the query asked, so that filter was never asserted.
     */
    it('ignores a voided bout sitting on the same piste at the same time', async () => {
      const { service: scheduleService } = makeService(
        piste([occupant({ id: 'cancelled', status: 'voided' })]),
      );

      await expect(
        scheduleService.scheduleMatch('match-1', 'lice-1', '2026-05-02T10:30:00.000Z'),
      ).resolves.toBeDefined();
    });

    it('skips the check when the placement clears the piste', async () => {
      const { service: scheduleService, supabase } = makeService(piste([occupant()]));

      await scheduleService.scheduleMatch('match-1', null, null);

      // Releasing a strip cannot collide with anything, so the occupancy read
      // never runs. One query, and it is the write — which is the actual claim,
      // where "the write called select()" was not.
      expect(queriedTables(supabase.from)).toEqual(['matches']);
    });
  });

  // Slice 6 of the schedule overhaul: clear every match of a pool on a
  // given day. Backs the "Clear pool" action on the schedule grid.
  describe('clearPoolScheduleForDay', () => {
    /**
     * The day window is resolved in the EVENT's timezone, so the service reads
     * `pools` before it writes `matches`. Pools carry no event id of their own —
     * the chain is pool → phase → tournament → event — so the embed rides on the
     * seeded row.
     */
    const poolDay = (
      timezone: string,
      matches: Array<Record<string, unknown>>,
    ): Record<string, TableSeed> => ({
      pools: { rows: [{ id: 'pool-1', phases: { tournaments: { events: { timezone } } } }] },
      matches: { rows: matches },
    });

    const bout = (id: string, scheduledAt: string) => ({
      id,
      pool_id: 'pool-1',
      lice_id: 'lice-1',
      scheduled_at: scheduledAt,
    });

    /**
     * Asserted as the SET of bouts the window caught, not as the arguments the
     * service handed `.gte()`. The old shape read `gte.mock.calls[0][1]`, which
     * says the code asked for a boundary and nothing about which fights that
     * boundary actually erases — the only thing the operator sees.
     */
    it('nulls lice_id + scheduled_at on every pool match scheduled on the given day', async () => {
      const { service: clearService, supabase } = makeService(
        poolDay('UTC', [
          bout('day-before', '2026-05-01T23:59:00.000Z'),
          bout('match-1', '2026-05-02T09:00:00.000Z'),
          bout('match-2', '2026-05-02T18:00:00.000Z'),
          bout('day-after', '2026-05-03T00:00:00.000Z'),
        ]),
      );

      await clearService.clearPoolScheduleForDay('pool-1', '2026-05-02');

      const [cleared] = writesTo(supabase, 'matches');
      expect(cleared?.row).toMatchObject({ lice_id: null, scheduled_at: null });
      expect(scopedTo(cleared, 'pool_id')).toBe('pool-1');
      // Clearing a time IS a reschedule. This route told the queue nothing at
      // all until 2026-08-15, so every fight it wiped kept its "starting soon".
      // The two bouts outside the window must survive — the one sitting exactly
      // on the next local midnight is out, because the window is half-open.
      expect(mockMatchAlerts.refresh).toHaveBeenCalledWith(['match-1', 'match-2']);
    });

    /**
     * The window is the event's day, not the UTC day. Los Angeles rather than
     * Paris on purpose: the suite already runs under UTC and Europe/Paris, and
     * neither can see this — UTC is the old behaviour, and Paris shifts the
     * boundary by an hour or two into the small hours where no fixture lives. A
     * negative offset moves it into the middle of the competition day, which is
     * where a real event would have met it.
     */
    it('measures the day on the event clock, not in UTC', async () => {
      // 2026-05-02 00:00 in Los Angeles (PDT, UTC-7) is 07:00Z the same day, and
      // the next local midnight is 07:00Z on the 3rd. `previous-evening` is
      // 22:00 on the 1st in Los Angeles but falls inside 2026-05-02 in UTC, so
      // the old window wiped it while sparing that morning's real bouts.
      //
      // `next-local-day` sits past the upper boundary on purpose. Without a bout
      // out there this test cannot see the upper bound go missing at all — which
      // it could when the assertion was on `.gte()` and `.lt()`'s arguments.
      const { service: clearService } = makeService(
        poolDay('America/Los_Angeles', [
          bout('previous-evening', '2026-05-02T05:00:00.000Z'),
          bout('local-morning', '2026-05-02T16:00:00.000Z'),
          bout('next-local-day', '2026-05-03T08:00:00.000Z'),
        ]),
      );

      await clearService.clearPoolScheduleForDay('pool-1', '2026-05-02');

      expect(mockMatchAlerts.refresh).toHaveBeenCalledWith(['local-morning']);
    });

    /**
     * A local day is 23 or 25 hours twice a year. An `end = start + 24h` range
     * would clear an hour too little or too much on those two days, so each
     * boundary resolves independently.
     */
    it('spans exactly one local day across a DST change', async () => {
      // Europe/Paris springs forward on 2026-03-29, so that local day runs
      // 2026-03-28T23:00Z → 2026-03-29T22:00Z, which is 23 hours. A `start + 24h`
      // range would run to 23:00Z and take `next-day` with it — 00:30 on the
      // 30th in Paris, and part of the following day's schedule.
      const { service: clearService } = makeService(
        poolDay('Europe/Paris', [
          bout('last-bout', '2026-03-29T21:30:00.000Z'),
          bout('next-day', '2026-03-29T22:30:00.000Z'),
        ]),
      );

      await clearService.clearPoolScheduleForDay('pool-1', '2026-03-29');

      expect(mockMatchAlerts.refresh).toHaveBeenCalledWith(['last-bout']);
    });
  });

  // ── Throughput test ───────────────────────────────────────────────────────

  describe('throughput — 50+ exchanges/sec', () => {
    it('processes 50 exchange inserts in under 1 second (mocked DB)', async () => {
      const N = 50;
      // Concurrency makes ordered mockReturnValueOnce non-deterministic (and the
      // extra round-state fetch per insert amplifies that), so use a single
      // default chain: idempotency + round fetch resolve null (fresh, round 1,
      // not awaiting); inserts resolve with an id.
      const chain = makeChain({ data: null, error: null });
      chain.single.mockResolvedValue({ data: { id: 'ex' }, error: null });
      fromMock.mockReturnValue(chain);

      const start = Date.now();
      const promises = Array.from({ length: N }, (_, i) =>
        service.createExchange('match-1', {
          clientUuid: `uuid-${i}`,
          sequence: i + 1,
          type: 'clean',
          occurredAt: new Date().toISOString(),
          firstStrikerColor: i % 2 === 0 ? 'red' : 'blue',
          firstStrikeValue: 1,
        }),
      );

      await Promise.all(promises);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledTimes(N);
    });
  });
  describe('match correction operations', () => {
    it('resetMatch requires the exact confirmation phrase', async () => {
      await expect(
        service.resetMatch('match-1', { confirmation: 'reset', reason: 'test' }),
      ).rejects.toThrow(BadRequestException);
      expect(fromMock).not.toHaveBeenCalled();
    });

    /**
     * The bout that lies about how it ended.
     *
     * Nothing on the way back IN clears `end_reason`: the clock's `end` writes
     * status + ended_at + the durations and never touches it, and scoring writes
     * it only inside `justCompleted`. So a match reset after a double cap and
     * then re-fought to a clock end is `completed` with `end_reason` still
     * reading 'max_doubles' — and that value is not decoration.
     * `swiss-standings.service.ts` maps it to ['loss','loss'] and the HEMA
     * Ratings submission documents the same meaning, so BOTH fighters lose a
     * bout one of them just won, in the export that leaves the platform.
     *
     * Asserted on the update object rather than through a replay because the
     * reason has to be gone at the moment of the reset — a later re-completion
     * is exactly what does NOT repair it.
     */
    it('resetMatch clears the previous fight end reason and durations', async () => {
      const matchUpdate = makeChain({ data: { id: 'match-1' }, error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'matches') {
          const chain = matchUpdate;
          chain.maybeSingle.mockResolvedValue({
            data: { id: 'match-1', locked_at: null },
            error: null,
          });
          return chain;
        }
        return makeChain({ data: null, error: null });
      });

      await service.resetMatch('match-1', {
        confirmation: 'RESET MATCH',
        reason: 'replay the bout',
      });

      expect(matchUpdate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'scheduled',
          end_reason: null,
          duration_active_ms: null,
          duration_total_ms: null,
          winner_registration_id: null,
          started_at: null,
          ended_at: null,
        }),
      );
    });

    /**
     * A reset that leaves the bout locked has not reset anything an operator can
     * act on. Nothing else clears the lock: MatchAutoLockService only ever adds
     * one, and its group gate needs every match in the group completed or voided
     * — which a freshly reset one is not — so it never looks at the group again.
     * The reset is already refused unless the actor may override the lock, so
     * clearing it here needs no authority the call did not already have.
     */
    it('resetMatch clears the lock, so the bout can actually be scored again', async () => {
      const matchUpdate = makeChain({ data: { id: 'match-1' }, error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'matches') {
          matchUpdate.maybeSingle.mockResolvedValue({
            data: { id: 'match-1', locked_at: '2026-08-12T09:00:00.000Z' },
            error: null,
          });
          return matchUpdate;
        }
        return makeChain({ data: null, error: null });
      });

      await service.resetMatch(
        'match-1',
        { confirmation: 'RESET MATCH', reason: 'replay the bout' },
        { userId: 'organiser-1', canOverrideLocked: true },
      );

      expect(matchUpdate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          locked_at: null,
          locked_by_user_id: null,
          locked_by_staff_account_id: null,
          lock_source: null,
          lock_reason: null,
        }),
      );
    });

    it('resetMatch fails loudly when the reset_match event cannot be written', async () => {
      // That event is the only thing returning the derived clock to `idle`.
      // Swallowed, it leaves a bout that reads `scheduled` to every list and
      // `ended` to the pad — and `VALID_TRANSITIONS.ended` is `['reopen']`, so
      // it cannot be started.
      fromMock.mockImplementation((table: string) => {
        if (table === 'match_events') {
          const chain = makeChain({ data: null, error: null });
          // The sequence probe succeeds; the insert is what fails. `insert` is
          // awaited directly here (no terminal `.single()`), so the double has
          // to resolve the result object rather than return the chain.
          chain.maybeSingle.mockResolvedValue({ data: null, error: null });
          chain.insert.mockResolvedValue({ error: { message: 'sequence conflict' } });
          return chain;
        }
        const chain = makeChain({ data: { id: 'match-1' }, error: null });
        chain.maybeSingle.mockResolvedValue({
          data: { id: 'match-1', locked_at: null },
          error: null,
        });
        return chain;
      });

      await expect(
        service.resetMatch('match-1', { confirmation: 'RESET MATCH', reason: 'replay' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('swapFighterSide toggles visual side order only', async () => {
      const lockChain = makeChain({ data: null, error: null });
      lockChain.maybeSingle.mockResolvedValue({
        data: { id: 'match-1', side_order: 'red_left', locked_at: null },
        error: null,
      });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'match-1', side_order: 'blue_left' },
        error: null,
      });
      fromMock.mockReturnValueOnce(lockChain).mockReturnValueOnce(updateChain);

      const result = await service.swapFighterSide('match-1');

      expect(updateChain.update).toHaveBeenCalledWith({
        side_order: 'blue_left',
        updated_at: expect.any(String),
      });
      expect(result).toEqual({ id: 'match-1', side_order: 'blue_left' });
      expect(mockScoring.recomputeMatchScore).not.toHaveBeenCalled();
    });

    it('locked matches reject staff correction operations', async () => {
      const exchangeChain = makeChain({ data: null, error: null });
      exchangeChain.maybeSingle.mockResolvedValue({
        data: { id: 'ex-1', match_id: 'match-1', voided: false },
        error: null,
      });
      const lockChain = makeChain({ data: null, error: null });
      lockChain.maybeSingle.mockResolvedValue({
        data: { id: 'match-1', locked_at: '2026-05-05T12:00:00.000Z' },
        error: null,
      });
      fromMock.mockReturnValueOnce(exchangeChain).mockReturnValue(lockChain);

      await expect(service.voidExchange('ex-1', {}, { staffAccountId: 'staff-1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Slice D ──────────────────────────────────────────────────────────────
  // Per-match referee assignment goes through `referee_assignments` with
  // scope_type='match' (vs. the legacy single matches.referee_id field
  // which the public PATCH still writes for back-compat). The setter
  // always deletes the existing row for (match_id, role) and then either
  // stops (refereeId=null) or inserts the new row.
  /**
   * PATCH /matches/:id moves one fight between pistes without touching its
   * time. The queued alert names the piste as well as the minute, and freezes
   * both at enqueue — so this write left the alert arriving exactly on time and
   * naming a piste the fight had left. That is why it was never noticed.
   */
  describe('update — a piste change is an alert change', () => {
    it('re-queues the alert when the piste moves', async () => {
      fromMock.mockReturnValue(makeChain({ data: { id: 'match-1' }, error: null }));

      await service.update('match-1', { liceId: 'lice-9' } as never);

      expect(mockMatchAlerts.refresh).toHaveBeenCalledWith(['match-1']);
    });

    it('leaves the queue alone for the legacy referee column', async () => {
      // `matches.referee_id` is the legacy single-referee field. No alert body
      // is built from it — the referee's own alert comes off
      // `referee_assignments` — so refreshing here would be queue work for a
      // change no reader can see.
      fromMock.mockReturnValue(makeChain({ data: { id: 'match-1' }, error: null }));

      await service.update('match-1', { refereeId: 'person-1' } as never);

      expect(mockMatchAlerts.refresh).not.toHaveBeenCalled();
    });
  });

  describe('setRefereeRoleAssignment', () => {
    /**
     * One bout, its two registrations, and an empty assignment table.
     *
     * The real DB resolves the event in ONE query via
     * matches → phases → tournaments.event_id, and match-scoped rows must be
     * lice-null. NOTE: mocks cannot reproduce the real-DB failures this fixed
     * (a missing phases.event_id column, and the scope CHECK forbidding a
     * non-null lice_id on scope_type='match') — so these assertions pin the
     * query and row SHAPE that the real DB requires.
     */
    const refereeSeed = (
      registrations: Array<Record<string, unknown>>,
    ): Record<string, TableSeed> => ({
      matches: {
        rows: [
          {
            id: 'match-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-blue',
            phases: { tournaments: { event_id: 'event-1' } },
          },
        ],
      },
      registrations: { rows: registrations },
      referee_assignments: { rows: [] },
    });

    /** Two fighters, neither of them the referee being offered. */
    const STRANGERS = [
      { id: 'reg-red', persons: { global_person_id: 'person-2' } },
      { id: 'reg-blue', persons: { global_person_id: 'person-3' } },
    ];

    it('upserts a row in referee_assignments with scope_type=match', async () => {
      const { service: refereeService, supabase } = makeService(refereeSeed(STRANGERS));

      await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');

      const [cleared, inserted] = writesTo(supabase, 'referee_assignments');
      // The delete's SCOPE, not merely that a delete happened. An unscoped clear
      // would drop every assignment on the event and still satisfy the old
      // `expect(chain.delete).toHaveBeenCalled()`.
      expect(cleared?.op).toBe('delete');
      expect(scopedTo(cleared, 'scope_type')).toBe('match');
      expect(scopedTo(cleared, 'match_id')).toBe('match-1');
      expect(scopedTo(cleared, 'role')).toBe('arbitre_declarant');
      expect(inserted?.row).toMatchObject({
        event_id: 'event-1',
        person_id: 'person-1',
        scope_type: 'match',
        pool_id: null,
        match_id: 'match-1',
        lice_id: null,
        role: 'arbitre_declarant',
        auto_assigned: false,
        status: 'assigned',
      });
    });

    it('only deletes when refereeId is null (unassign)', async () => {
      const { service: refereeService, supabase } = makeService(refereeSeed(STRANGERS));

      await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', null);

      expect(writesTo(supabase, 'referee_assignments').map((write) => write.op)).toEqual([
        'delete',
      ]);
    });

    // ── Hard rule 8 ────────────────────────────────────────────────────────
    //
    // A fighter may not referee their own fight, and that rule cannot be
    // switched off. The assignment board enforced it on its own manual path
    // while this route — the one the pool tab's matches table calls — enforced
    // nothing at all.
    //
    // Every case here asserts the SELECT STRING as well as the outcome. The
    // double answers with whatever the fixture holds no matter what was asked
    // for, so a value-only assertion stays green with the column deleted from
    // the read. That is exactly how a column can sit missing from a select for
    // years with a full test suite passing over it.
    describe('setRefereeRoleAssignment — a fighter cannot referee their own match', () => {
      it('refuses the red fighter, and reads the columns it judges on', async () => {
        // `person-1` is the referee being offered AND the global person behind
        // the red corner's registration.
        const { service: refereeService, supabase } = makeService(
          refereeSeed([
            { id: 'reg-red', persons: { global_person_id: 'person-1' } },
            { id: 'reg-blue', persons: { global_person_id: 'person-2' } },
          ]),
        );

        await expect(
          refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1'),
        ).rejects.toThrow('A fighter cannot referee their own match');

        // Refused BEFORE anything was written — not deleted-then-refused, which
        // would drop the crew that was already correct. Across every table now,
        // rather than one watched chain.
        expect(supabase.writes).toEqual([]);

        // The projection, not just the answer. Delete either registration column
        // from the match read and this reds. Collected by TABLE, so inserting a
        // query upstream cannot silently move which projection is asserted.
        expect(selectsFor(supabase.from, 'matches')[0]).toContain('red_registration_id');
        expect(selectsFor(supabase.from, 'matches')[0]).toContain('blue_registration_id');
        expect(selectsFor(supabase.from, 'registrations')[0]).toContain('global_person_id');
      });

      it('refuses the blue fighter too', async () => {
        const { service: refereeService, supabase } = makeService(
          refereeSeed([
            { id: 'reg-red', persons: { global_person_id: 'person-2' } },
            { id: 'reg-blue', persons: { global_person_id: 'person-1' } },
          ]),
        );

        await expect(
          refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1'),
        ).rejects.toThrow('A fighter cannot referee their own match');
        expect(supabase.writes).toEqual([]);
      });

      it('lets a referee who is not in the bout through', async () => {
        const { service: refereeService, supabase } = makeService(refereeSeed(STRANGERS));

        await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');

        const [, inserted] = writesTo(supabase, 'referee_assignments');
        expect(inserted?.row).toMatchObject({ person_id: 'person-1', match_id: 'match-1' });
      });

      it('compares global person ids, not the per-event persons.id', async () => {
        // THE failure mode this guard dies of. `referee_assignments.person_id`
        // is a `global_persons.id`; a registration reaches that space through
        // `persons.global_person_id` — NOT `persons.id`, which is the per-event
        // identity and a different space entirely. Read `persons.id` instead and
        // the guard matches nothing, never fires, and looks perfectly healthy.
        //
        // Here the red fighter's per-event `persons.id` IS the referee id and
        // their global person is somebody else. A guard reading the wrong
        // column refuses this; the right one lets it through.
        const { service: refereeService, supabase } = makeService(
          refereeSeed([
            { id: 'reg-red', persons: { id: 'person-1', global_person_id: 'person-9' } },
            { id: 'reg-blue', persons: { id: 'person-8', global_person_id: 'person-2' } },
          ]),
        );

        await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');

        expect(writesTo(supabase, 'referee_assignments').map((write) => write.op)).toEqual([
          'delete',
          'insert',
        ]);
      });

      it('does not collapse two unidentifiable fighters onto one empty key', async () => {
        // A registration with no global person is SKIPPED, never compared under
        // ''. Defaulting to an empty string would make every unlinked
        // registration match every unlinked referee.
        const { service: refereeService, supabase } = makeService(
          refereeSeed([
            { id: 'reg-red', persons: { global_person_id: null } },
            { id: 'reg-blue', persons: null },
          ]),
        );

        await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', '');

        expect(writesTo(supabase, 'referee_assignments').map((write) => write.op)).toEqual([
          'delete',
          'insert',
        ]);
      });

      /**
       * The registrations read is scoped `.in('id', [red, blue])`. Without that
       * scope this third row — the same global person as the referee, but
       * fighting in a different bout — would refuse an assignment that is
       * perfectly legal. The canned double returned the whole fixture whatever
       * was asked, so the scope was unasserted.
       */
      it('ignores a registration that belongs to another bout', async () => {
        const { service: refereeService, supabase } = makeService(
          refereeSeed([
            ...STRANGERS,
            { id: 'reg-elsewhere', persons: { global_person_id: 'person-1' } },
          ]),
        );

        await refereeService.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');

        expect(writesTo(supabase, 'referee_assignments').map((write) => write.op)).toEqual([
          'delete',
          'insert',
        ]);
      });
    });
  });
});
