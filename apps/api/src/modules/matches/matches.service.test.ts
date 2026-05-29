import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MatchesService } from './matches.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };
const mockScoring = {
  recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
};
const mockNotificationScheduler = {
  scheduleMatchStarting: vi.fn().mockResolvedValue(undefined),
};
const mockFollowNotificationScheduler = {
  scheduleMatchStarting: vi.fn().mockResolvedValue(undefined),
};
const mockFrozenResults = {
  assertExchangeCreationAllowed: vi.fn().mockResolvedValue(undefined),
  guardExchangeMutation: vi.fn().mockResolvedValue(null),
};

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MatchesService', () => {
  let service: MatchesService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new MatchesService(
      mockSupabase as never,
      mockScoring as never,
      mockNotificationScheduler as never,
      mockFollowNotificationScheduler as never,
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
      // match label `L1-PA-M1` → formatRoundCode yields `LSW-P1-ML1-PA-M1`.
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'vw_tournament_query_matches') {
          return makeChain({
            data: {
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
            },
            error: null,
          });
        }
        if (tableName === 'tournaments') {
          return makeChain({ data: { weapon: 'longsword' }, error: null });
        }
        if (tableName === 'pools') {
          return makeChain({ data: { sort_order: 0 }, error: null });
        }
        return makeChain({ data: null, error: null });
      });

      const result = (await service.getMatchSummary('m1')) as { roundCode: string };

      expect(result.roundCode).toBe('LSW-P1-ML1-PA-M1');
    });

    it('reads bracketSize from phases.config_json so bracket matches render LSW-R16-M1', async () => {
      // After stamping match_number_label on bracket matches, the scoreboard
      // had to ALSO fetch the phase's bracketSize to translate
      // bracket_round → R16/QF/SF/F. Without this, the code fell back to
      // B{round} and diverged from the bracket-card label.
      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'vw_tournament_query_matches') {
          return makeChain({
            data: {
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
              phase_id: 'phase-1',
            },
            error: null,
          });
        }
        if (tableName === 'tournaments') {
          return makeChain({ data: { weapon: 'longsword' }, error: null });
        }
        if (tableName === 'phases') {
          return makeChain({
            data: { config_json: { bracketSize: 16 } },
            error: null,
          });
        }
        return makeChain({ data: null, error: null });
      });

      const result = (await service.getMatchSummary('m-r16-1')) as { roundCode: string };

      expect(result.roundCode).toBe('LSW-R16-M1');
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

      // insert: success
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: newExchange, error: null });

      fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(insertChain);

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

    it('rejects new exchange creation when event results are frozen', async () => {
      service = new MatchesService(
        mockSupabase as never,
        mockScoring as never,
        mockNotificationScheduler as never,
        mockFollowNotificationScheduler as never,
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
        mockSupabase as never,
        mockScoring as never,
        mockNotificationScheduler as never,
        mockFollowNotificationScheduler as never,
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
        mockSupabase as never,
        mockScoring as never,
        mockNotificationScheduler as never,
        mockFollowNotificationScheduler as never,
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
        mockSupabase as never,
        mockScoring as never,
        mockNotificationScheduler as never,
        mockFollowNotificationScheduler as never,
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

      fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(insertChain);

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

  describe('scheduleMatch', () => {
    it('reschedules match-starting and follow notifications when scheduled_at changes', async () => {
      const scheduledAt = '2026-05-02T10:30:00.000Z';
      const updateChain = makeChain({
        data: { id: 'match-1', scheduled_at: scheduledAt },
        error: null,
      });
      updateChain.single.mockResolvedValue({
        data: { id: 'match-1', scheduled_at: scheduledAt },
        error: null,
      });
      fromMock.mockReturnValue(updateChain);

      await service.scheduleMatch('match-1', 'lice-1', scheduledAt);

      expect(mockNotificationScheduler.scheduleMatchStarting).toHaveBeenCalledWith('match-1');
      expect(mockFollowNotificationScheduler.scheduleMatchStarting).toHaveBeenCalledWith('match-1');
    });
  });

  // ── Throughput test ───────────────────────────────────────────────────────

  describe('throughput — 50+ exchanges/sec', () => {
    it('processes 50 exchange inserts in under 1 second (mocked DB)', async () => {
      const N = 50;
      const start = Date.now();

      for (let i = 0; i < N; i++) {
        const checkChain = makeChain({ data: null, error: null });
        checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });

        const insertChain = makeChain({ data: null, error: null });
        insertChain.single.mockResolvedValue({ data: { id: `ex-${i}` }, error: null });

        fromMock.mockReturnValueOnce(checkChain).mockReturnValueOnce(insertChain);
      }

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
    it('clearLastExchange voids the latest non-voided exchange', async () => {
      const lockChain = makeChain({ data: null, error: null });
      lockChain.maybeSingle.mockResolvedValue({
        data: { id: 'match-1', locked_at: null },
        error: null,
      });
      const latestChain = makeChain({ data: null, error: null });
      latestChain.maybeSingle.mockResolvedValue({
        data: { id: 'ex-2', match_id: 'match-1', voided: false },
        error: null,
      });
      const fetchExchangeChain = makeChain({ data: null, error: null });
      fetchExchangeChain.maybeSingle.mockResolvedValue({
        data: { id: 'ex-2', match_id: 'match-1', voided: false },
        error: null,
      });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'ex-2', match_id: 'match-1', voided: true },
        error: null,
      });
      fromMock
        .mockReturnValueOnce(lockChain)
        .mockReturnValueOnce(latestChain)
        .mockReturnValueOnce(fetchExchangeChain)
        .mockReturnValueOnce(updateChain);

      await service.clearLastExchange('match-1', { reason: 'wrong call' });

      expect(latestChain.order).toHaveBeenCalledWith('sequence', { ascending: false });
      expect(updateChain.update).toHaveBeenCalledWith({
        voided: true,
        voided_reason: 'wrong call',
      });
      expect(mockScoring.recomputeMatchScore).toHaveBeenCalledWith('match-1');
    });

    it('resetMatch requires the exact confirmation phrase', async () => {
      await expect(
        service.resetMatch('match-1', { confirmation: 'reset', reason: 'test' }),
      ).rejects.toThrow(BadRequestException);
      expect(fromMock).not.toHaveBeenCalled();
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
      const lockChain = makeChain({ data: null, error: null });
      lockChain.maybeSingle.mockResolvedValue({
        data: { id: 'match-1', locked_at: '2026-05-05T12:00:00.000Z' },
        error: null,
      });
      fromMock.mockReturnValue(lockChain);

      await expect(
        service.clearLastExchange('match-1', {}, { staffAccountId: 'staff-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Slice D ──────────────────────────────────────────────────────────────
  // Per-match referee assignment goes through `referee_assignments` with
  // scope_type='match' (vs. the legacy single matches.referee_id field
  // which the public PATCH still writes for back-compat). The setter
  // always deletes the existing row for (match_id, role) and then either
  // stops (refereeId=null) or inserts the new row.
  describe('setRefereeRoleAssignment', () => {
    // The service does `await this.supabase.service.from('referee_assignments').delete().eq(...).eq(...).eq(...)`,
    // so the chain itself must be thenable. `makeChain` is not — patch
    // it to a Promise-wrapped variant for the referee_assignments
    // chain that resolves to { data: null, error: null } when awaited.
    function makeAwaitableDeleteChain() {
      const result = { data: null, error: null };
      const promise = Promise.resolve(result);
      const chain = Object.assign(promise, {
        select: vi.fn(),
        eq: vi.fn(),
        delete: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        insert: vi.fn().mockResolvedValue(result),
        update: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
      });
      for (const key of ['select', 'eq', 'delete', 'in', 'order', 'update']) {
        (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
      }
      return chain;
    }

    it('upserts a row in referee_assignments with scope_type=match', async () => {
      let insertedRow: Record<string, unknown> | null = null;
      const refereeChain = makeAwaitableDeleteChain();
      refereeChain.insert = vi.fn((row: Record<string, unknown>) => {
        insertedRow = row;
        return Promise.resolve({ data: null, error: null });
      }) as never;

      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'matches') {
          return makeChain({ data: { phase_id: 'phase-1', lice_id: 'lice-1' }, error: null });
        }
        if (tableName === 'phases') {
          return makeChain({ data: { event_id: 'event-1' }, error: null });
        }
        if (tableName === 'referee_assignments') {
          return refereeChain;
        }
        return makeChain({ data: null, error: null });
      });

      await service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');

      expect(refereeChain.delete).toHaveBeenCalled();
      expect(insertedRow).toMatchObject({
        event_id: 'event-1',
        person_id: 'person-1',
        scope_type: 'match',
        pool_id: null,
        match_id: 'match-1',
        lice_id: 'lice-1',
        role: 'arbitre_declarant',
        auto_assigned: false,
        status: 'assigned',
      });
    });

    it('only deletes when refereeId is null (unassign)', async () => {
      const refereeChain = makeAwaitableDeleteChain();
      const insertSpy = vi.fn();
      refereeChain.insert = insertSpy as never;

      fromMock.mockImplementation((tableName: string) => {
        if (tableName === 'matches') {
          return makeChain({ data: { phase_id: 'phase-1', lice_id: null }, error: null });
        }
        if (tableName === 'phases') {
          return makeChain({ data: { event_id: 'event-1' }, error: null });
        }
        if (tableName === 'referee_assignments') {
          return refereeChain;
        }
        return makeChain({ data: null, error: null });
      });

      await service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', null);

      expect(refereeChain.delete).toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });
  });
});
