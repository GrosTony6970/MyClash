import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { REGISTRATION_STATUS_TRANSITIONS } from './dto/registrations.dto';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    nullsFirst: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.nullsFirst.mockReturnValue(chain);
  return chain;
}

/**
 * Creates a chain that is also awaitable (resolves to `result`).
 * Used for `const { data, error } = await q` patterns.
 */
function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    nullsFirst: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete', 'nullsFirst']) {
    (chain as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RegistrationsService', () => {
  let service: RegistrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new RegistrationsService(mockSupabase as never);
  });

  // ── Status transitions ────────────────────────────────────────────────────

  describe('updateStatus — status transition enforcement', () => {
    it('allows registered → checked_in', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'registered' }, error: null });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.updateStatus('reg-1', 'checked_in');
      expect((result as { status: string }).status).toBe('checked_in');
    });

    it('blocks registered → done (cannot skip checked_in)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'registered' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateStatus('reg-1', 'done'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks checked_in → registered (no going back)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateStatus('reg-1', 'registered'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows checked_in → done', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.updateStatus('reg-1', 'done');
      expect((result as { status: string }).status).toBe('done');
    });

    it('blocks done → any (terminal state)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateStatus('reg-1', 'checked_in'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for nonexistent registration', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateStatus('nonexistent', 'checked_in'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Bib auto-assign ───────────────────────────────────────────────────────

  describe('create — bib auto-assign', () => {
    it('auto-assigns bib_number = max + 1 when not provided', async () => {
      // nextBibNumber query returns max=5 (awaitable chain)
      const bibChain = makeAwaitableChain({ data: [{ bib_number: 5 }], error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-new', bib_number: 6, status: 'registered' },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(bibChain)    // nextBibNumber
        .mockReturnValueOnce(insertChain); // insert

      const result = await service.create('tournament-1', { personId: 'person-1' });
      expect((result as { bib_number: number }).bib_number).toBe(6);
    });

    it('uses provided bib_number when given', async () => {
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-new', bib_number: 42, status: 'registered' },
        error: null,
      });
      fromMock.mockReturnValue(insertChain);

      const result = await service.create('tournament-1', { personId: 'person-1', bibNumber: 42 });
      expect((result as { bib_number: number }).bib_number).toBe(42);
    });
  });

  // ── Transition table completeness ─────────────────────────────────────────

  describe('REGISTRATION_STATUS_TRANSITIONS', () => {
    it('covers all defined statuses', () => {
      const statuses = ['registered', 'checked_in', 'done', 'withdrawn', 'disqualified'];
      for (const s of statuses) {
        expect(REGISTRATION_STATUS_TRANSITIONS).toHaveProperty(s);
      }
    });

    it('registered can only go to checked_in', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['registered']).toEqual(['checked_in']);
    });

    it('done is a terminal state (no transitions)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['done']).toEqual([]);
    });
  });
});
