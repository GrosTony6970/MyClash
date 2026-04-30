import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MatchesService } from './matches.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };
const mockScoring = { recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }) };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MatchesService', () => {
  let service: MatchesService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new MatchesService(mockSupabase as never, mockScoring as never);
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

      fromMock
        .mockReturnValueOnce(checkChain)
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

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain);

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
  });

  // ── Score recomputation ───────────────────────────────────────────────────

  describe('score recomputation', () => {
    it('recomputeMatchScore is called after every new exchange insert', async () => {
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({ data: { id: 'ex-1' }, error: null });

      fromMock
        .mockReturnValueOnce(checkChain)
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

        fromMock
          .mockReturnValueOnce(checkChain)
          .mockReturnValueOnce(insertChain);
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
});
