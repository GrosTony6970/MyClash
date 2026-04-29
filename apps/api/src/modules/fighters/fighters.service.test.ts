import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FightersService } from './fighters.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FightersService', () => {
  let service: FightersService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new FightersService(mockSupabase as never);
  });

  describe('promote', () => {
    it('throws NotFoundException when person does not exist', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(
        service.promote({ personId: 'nonexistent-person' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when claimed user does not own the Person', async () => {
      fromMock.mockReturnValue({
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'person-1',
            given_name: 'Jean',
            family_name: 'Dupont',
            email: 'jean@example.com',
            club_id: null,
            claimed_by_user_id: 'user-A',  // owned by user-A
            global_fighter_id: null,
          },
          error: null,
        }),
      });

      // user-B tries to promote person owned by user-A
      await expect(
        service.promote({ personId: 'person-1' }, 'user-B'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a Fighter when claimed user owns the Person', async () => {
      const personChain = {
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'person-1',
            given_name: 'Jean',
            family_name: 'Dupont',
            email: 'jean@example.com',
            club_id: null,
            claimed_by_user_id: 'user-1',
            global_fighter_id: null,
          },
          error: null,
        }),
      };
      const insertChain = {
        ...makeChain({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'fighter-new', slug: 'jean-dupont-abc', display_name: 'Jean Dupont' },
          error: null,
        }),
      };
      const updateChain = {
        ...makeChain({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      fromMock
        .mockReturnValueOnce(personChain)   // persons select
        .mockReturnValueOnce(insertChain)   // fighters insert
        .mockReturnValueOnce(updateChain);  // persons update

      const result = await service.promote({ personId: 'person-1' }, 'user-1');
      expect((result as { id: string }).id).toBe('fighter-new');
    });

    it('returns existing Fighter if Person already promoted', async () => {
      const personChain = {
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'person-1',
            given_name: 'Jean',
            family_name: 'Dupont',
            email: 'jean@example.com',
            club_id: null,
            claimed_by_user_id: 'user-1',
            global_fighter_id: 'fighter-existing',
          },
          error: null,
        }),
      };
      const existingFighterChain = {
        ...makeChain({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'fighter-existing', slug: 'jean-dupont-old' },
          error: null,
        }),
      };

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(existingFighterChain);

      const result = await service.promote({ personId: 'person-1' }, 'user-1');
      expect((result as { id: string }).id).toBe('fighter-existing');
    });
  });

  describe('slugify (via create)', () => {
    it('generates a unique slug on create', async () => {
      const insertChain = {
        ...makeChain({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'f-1', slug: 'jean-dupont-abc123', display_name: 'Jean Dupont' },
          error: null,
        }),
      };
      fromMock.mockReturnValue(insertChain);

      const result = await service.create({
        givenName: 'Jean',
        familyName: 'Dupont',
        displayName: 'Jean Dupont',
      });

      expect((result as { slug: string }).slug).toContain('jean-dupont');
    });
  });
});
