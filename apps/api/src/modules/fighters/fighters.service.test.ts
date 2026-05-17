import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FightersService } from './fighters.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    or: vi.fn() as ReturnType<typeof vi.fn>,
    ilike: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.or.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FightersService', () => {
  let service: FightersService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new FightersService(mockSupabase as never, {} as never);
  });

  describe('promote', () => {
    it('throws NotFoundException when person does not exist', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.promote({ personId: 'nonexistent-person' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when claimed user does not own the Person', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: {
          id: 'person-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          email: 'jean@example.com',
          club_id: null,
          claimed_by_user_id: 'user-A', // owned by user-A
          global_person_id: null,
        },
        error: null,
      });
      fromMock.mockReturnValue(chain);

      // user-B tries to promote person owned by user-A
      await expect(service.promote({ personId: 'person-1' }, 'user-B')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates a Fighter when claimed user owns the Person', async () => {
      const personChain = makeChain({ data: null, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'person-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          email: 'jean@example.com',
          club_id: null,
          claimed_by_user_id: 'user-1',
          global_person_id: null,
        },
        error: null,
      });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'fighter-new', slug: 'jean-dupont-abc', display_name: 'Jean Dupont' },
        error: null,
      });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(personChain) // persons select
        .mockReturnValueOnce(insertChain) // fighters insert
        .mockReturnValueOnce(updateChain); // persons update

      const result = await service.promote({ personId: 'person-1' }, 'user-1');
      expect((result as { id: string }).id).toBe('fighter-new');
    });

    it('returns existing Fighter if Person already promoted', async () => {
      const personChain = makeChain({ data: null, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'person-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          email: 'jean@example.com',
          club_id: null,
          claimed_by_user_id: 'user-1',
          global_person_id: 'fighter-existing',
        },
        error: null,
      });

      const existingFighterChain = makeChain({ data: null, error: null });
      existingFighterChain.maybeSingle.mockResolvedValue({
        data: { id: 'fighter-existing', slug: 'jean-dupont-old' },
        error: null,
      });

      fromMock.mockReturnValueOnce(personChain).mockReturnValueOnce(existingFighterChain);

      const result = await service.promote({ personId: 'person-1' }, 'user-1');
      expect((result as { id: string }).id).toBe('fighter-existing');
    });
  });

  describe('getBySlug', () => {
    it('adds HEMA Ratings profile data when Fighter is linked', async () => {
      const fighterChain = makeChain({ data: null, error: null });
      fighterChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'fighter-1',
          slug: 'steven-gallagher',
          display_name: 'Steven Gallagher',
          hema_ratings_id: '10458',
        },
        error: null,
      });
      fromMock.mockReturnValue(fighterChain);
      const hemaRatings = {
        getProfile: vi.fn().mockResolvedValue({
          id: '10458',
          name: 'Steven Gallagher',
          club: 'Smart HEMA Clubs',
          detailsUrl: 'https://hemaratings.com/fighters/details/10458/',
          syncedAt: '2026-05-02T00:00:00.000Z',
          ratings: [
            {
              weapon: 'Longsword',
              category: "Mixed & Men's Steel Longsword",
              rank: 364,
              weightedRating: 1583.2,
              lastCompeted: '2026-03-01',
            },
          ],
        }),
      };
      service = new FightersService(
        mockSupabase as never,
        undefined as never,
        hemaRatings as never,
      );

      const result = await service.getBySlug('steven-gallagher');

      expect(result).toMatchObject({
        hema_ratings_id: '10458',
        hemaRatings: {
          id: '10458',
          syncedAt: '2026-05-02T00:00:00.000Z',
          ratings: [{ weapon: 'Longsword', weightedRating: 1583.2 }],
        },
      });
    });
  });

  describe('slugify (via create)', () => {
    it('generates a unique slug on create', async () => {
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'f-1', slug: 'jean-dupont-abc123', display_name: 'Jean Dupont' },
        error: null,
      });
      fromMock.mockReturnValue(insertChain);

      const result = await service.create({
        givenName: 'Jean',
        familyName: 'Dupont',
        displayName: 'Jean Dupont',
      });

      expect((result as { slug: string }).slug).toContain('jean-dupont');
    });
  });

  describe('global profile administration', () => {
    it('creates a global profile with club, HEMA Ratings ID, and roles', async () => {
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: {
          id: 'global-1',
          display_name: 'Jean Dupont',
          club_id: 'club-1',
          hema_ratings_id: '10458',
          is_fighter: true,
        },
        error: null,
      });
      fromMock.mockReturnValue(insertChain);

      const result = await service.createGlobalPerson({
        givenName: 'Jean',
        familyName: 'Dupont',
        displayName: '',
        clubId: 'club-1',
        hemaRatingsId: '10458',
        isFighter: true,
        isReferee: false,
        isWorkshopParticipant: false,
      });

      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          display_name: 'Jean Dupont',
          club_id: 'club-1',
          hema_ratings_id: '10458',
          is_fighter: true,
        }),
      );
      expect(result).toMatchObject({ id: 'global-1' });
    });

    it('requires at least one global profile role', async () => {
      await expect(
        service.createGlobalPerson({
          givenName: 'Jean',
          familyName: 'Dupont',
          isFighter: false,
          isReferee: false,
          isWorkshopParticipant: false,
        }),
      ).rejects.toThrow('At least one global profile role is required');
    });

    it('updates a global profile and creates a referee profile when referee is enabled', async () => {
      const existingChain = makeChain({ data: null, error: null });
      existingChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'global-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          display_name: 'Jean Dupont',
          is_fighter: true,
          is_referee: false,
          is_workshop_participant: false,
        },
        error: null,
      });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: {
          id: 'global-1',
          display_name: 'Jean D.',
          is_fighter: true,
          is_referee: true,
        },
        error: null,
      });

      const refereeChain = makeChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(existingChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(refereeChain);

      const result = await service.updateGlobalPerson('global-1', {
        displayName: 'Jean D.',
        hemaRatingsId: '10458',
        isReferee: true,
      });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          display_name: 'Jean D.',
          hema_ratings_id: '10458',
          is_referee: true,
        }),
      );
      expect(refereeChain.upsert).toHaveBeenCalledWith(
        { global_person_id: 'global-1' },
        { onConflict: 'global_person_id', ignoreDuplicates: true },
      );
      expect(result).toMatchObject({ id: 'global-1', is_referee: true });
    });
  });

  describe('claimed owner profile editing', () => {
    it('returns the private claimed fighter profile with date of birth for the owner', async () => {
      const fighterChain = makeChain({ data: null, error: null });
      fighterChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'fighter-1',
          slug: 'public-fighter',
          display_name: 'Public Fighter',
          claimed_by_user_id: 'user-1',
          date_of_birth: '1990-01-01',
        },
        error: null,
      });
      fromMock.mockReturnValue(fighterChain);

      await expect(service.getMyProfile('user-1')).resolves.toMatchObject({
        id: 'fighter-1',
        dateOfBirth: '1990-01-01',
      });
    });

    it('rejects updates when the claimed user does not own the fighter', async () => {
      const ownerChain = makeChain({ data: null, error: null });
      ownerChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'fighter-owned-by-someone-else',
          claimed_by_user_id: 'user-2',
        },
        error: null,
      });
      fromMock.mockReturnValue(ownerChain);

      await expect(
        service.updateMyProfile('user-1', {
          fighterId: 'fighter-owned-by-someone-else',
          displayName: 'Not Mine',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('omits date of birth from public fighter profiles', async () => {
      const fighterChain = makeChain({ data: null, error: null });
      fighterChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'fighter-1',
          slug: 'public-fighter',
          display_name: 'Public Fighter',
          date_of_birth: '1990-01-01',
        },
        error: null,
      });
      fromMock.mockReturnValue(fighterChain);

      const result = await service.getBySlug('public-fighter');
      expect(result).not.toHaveProperty('date_of_birth');
      expect(result).not.toHaveProperty('dateOfBirth');
    });
  });
});
