import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { REGISTRATION_STATUS_TRANSITIONS } from './dto/registrations.dto';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    nullsFirst: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
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
      fromMock
        .mockReturnValueOnce({
          ...makeChain({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'registered' }, error: null }),
        })
        .mockReturnValueOnce({
          ...makeChain({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null }),
        });

      const result = await service.updateStatus('reg-1', 'checked_in');
      expect((result as { status: string }).status).toBe('checked_in');
    });

    it('blocks registered → done (cannot skip checked_in)', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'registered' }, error: null }),
      });

      await expect(
        service.updateStatus('reg-1', 'done'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks checked_in → registered (no going back)', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null }),
      });

      await expect(
        service.updateStatus('reg-1', 'registered'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows checked_in → done', async () => {
      fromMock
        .mockReturnValueOnce({
          ...makeChain({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'checked_in' }, error: null }),
        })
        .mockReturnValueOnce({
          ...makeChain({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null }),
        });

      const result = await service.updateStatus('reg-1', 'done');
      expect((result as { status: string }).status).toBe('done');
    });

    it('blocks done → any (terminal state)', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null }),
      });

      await expect(
        service.updateStatus('reg-1', 'checked_in'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for nonexistent registration', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(
        service.updateStatus('nonexistent', 'checked_in'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Bib auto-assign ───────────────────────────────────────────────────────

  describe('create — bib auto-assign', () => {
    it('auto-assigns bib_number = max + 1 when not provided', async () => {
      // nextBibNumber query returns max=5
      const bibChain = {
        ...makeChain({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ bib_number: 5 }], error: null }),
      };
      const insertChain = {
        ...makeChain({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({
          data: { id: 'reg-new', bib_number: 6, status: 'registered' },
          error: null,
        }),
      };

      fromMock
        .mockReturnValueOnce(bibChain)   // nextBibNumber
        .mockReturnValueOnce(insertChain); // insert

      const result = await service.create('tournament-1', { personId: 'person-1' });
      expect((result as { bib_number: number }).bib_number).toBe(6);
    });

    it('uses provided bib_number when given', async () => {
      const insertChain = {
        ...makeChain({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({
          data: { id: 'reg-new', bib_number: 42, status: 'registered' },
          error: null,
        }),
      };
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
