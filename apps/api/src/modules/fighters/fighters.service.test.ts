import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FightersService, parseBoolCell } from './fighters.service';
import { buildRefereeStats, type RefereeAssignmentInput } from './referee-stats';

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

    it('replaces imported medals on profile update for the owner', async () => {
      const medalsChain = makeChain({ data: [], error: null });
      medalsChain.insert.mockResolvedValue({ data: null, error: null });
      const genericChain = makeChain({
        data: { id: 'fighter-1', claimed_by_user_id: 'user-1', display_name: 'Me' },
        error: null,
      });
      fromMock.mockImplementation((table: string) =>
        table === 'fighter_manual_medals' ? medalsChain : genericChain,
      );

      await service.updateMyProfile('user-1', {
        fighterId: 'fighter-1',
        displayName: 'Me',
        medals: [
          { competition: 'Swordfish', year: 2019, rank: 1, weapon: 'Longsword' },
          { competition: 'Fechtschule', year: 2021, rank: 3, weapon: 'Rapier' },
        ],
      });

      expect(medalsChain.delete).toHaveBeenCalled();
      expect(medalsChain.eq).toHaveBeenCalledWith('global_person_id', 'fighter-1');
      expect(medalsChain.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          global_person_id: 'fighter-1',
          competition: 'Swordfish',
          year: 2019,
          rank: 1,
          weapon: 'Longsword',
          sort_order: 0,
        }),
        expect.objectContaining({
          global_person_id: 'fighter-1',
          competition: 'Fechtschule',
          year: 2021,
          rank: 3,
          weapon: 'Rapier',
          sort_order: 1,
        }),
      ]);
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

  describe('profile photo', () => {
    const storagePart = () => {
      const bucketApi = {
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi
          .fn()
          .mockReturnValue({ data: { publicUrl: 'https://cdn.example/photo.jpg' } }),
      };
      const storage = {
        getBucket: vi.fn().mockResolvedValue({ data: { name: 'fighter-photos' }, error: null }),
        createBucket: vi.fn().mockResolvedValue({ error: null }),
        from: vi.fn().mockReturnValue(bucketApi),
      };
      (mockSupabase.service as unknown as { storage: unknown }).storage = storage;
      return { storage, bucketApi };
    };

    const png = () => ({
      buffer: Buffer.from('image-bytes'),
      filename: 'me.png',
      mimetype: 'image/png',
    });

    it('uploads the photo and writes a same-origin photo_url on the claimed global person', async () => {
      const { bucketApi } = storagePart();
      const idChain = makeChain({ data: { id: 'gp-1' }, error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValueOnce(idChain).mockReturnValueOnce(updateChain);

      const result = await service.uploadMyPhoto('user-1', png());

      // Same-origin relative path (not Supabase's absolute getPublicUrl) so the
      // photo also loads on the cross-origin admin external-display popup. The
      // path carries the person id + a timestamped filename.
      const photoUrlPattern =
        /^\/storage\/v1\/object\/public\/fighter-photos\/fighters\/gp-1\/photo-\d+\.png$/u;
      expect(result.url).toMatch(photoUrlPattern);
      expect(bucketApi.upload).toHaveBeenCalledOnce();
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ photo_url: expect.stringMatching(photoUrlPattern) }),
      );
    });

    it('throws NotFoundException when no global person is linked', async () => {
      storagePart();
      fromMock.mockReturnValue(makeChain({ data: null, error: null }));
      await expect(service.uploadMyPhoto('user-1', png())).rejects.toThrow(NotFoundException);
    });

    it('rejects an empty upload', async () => {
      storagePart();
      fromMock.mockReturnValue(makeChain({ data: { id: 'gp-1' }, error: null }));
      await expect(
        service.uploadMyPhoto('user-1', {
          buffer: Buffer.alloc(0),
          filename: 'x.png',
          mimetype: 'image/png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-image mime type', async () => {
      storagePart();
      fromMock.mockReturnValue(makeChain({ data: { id: 'gp-1' }, error: null }));
      await expect(
        service.uploadMyPhoto('user-1', {
          buffer: Buffer.from('x'),
          filename: 'x.gif',
          mimetype: 'image/gif',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an upload above the 15 MB cap', async () => {
      storagePart();
      fromMock.mockReturnValue(makeChain({ data: { id: 'gp-1' }, error: null }));
      await expect(
        service.uploadMyPhoto('user-1', {
          buffer: Buffer.alloc(15 * 1024 * 1024 + 1),
          filename: 'huge.png',
          mimetype: 'image/png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears photo_url on remove', async () => {
      const idChain = makeChain({ data: { id: 'gp-1' }, error: null });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValueOnce(idChain).mockReturnValueOnce(updateChain);

      const result = await service.removeMyPhoto('user-1');

      expect(result).toEqual({ url: null });
      expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ photo_url: null }));
    });
  });

  describe('fetchFighterNamesByMatch', () => {
    type Resolver = {
      fetchFighterNamesByMatch: (
        ids: string[],
      ) => Promise<Map<string, { redName: string | null; blueName: string | null }>>;
    };

    it('resolves red/blue fighter names per match with global display-name fallback', async () => {
      const matchesChain = makeChain({ data: null, error: null });
      matchesChain.in.mockResolvedValue({
        data: [
          { id: 'm1', red_registration_id: 'r1', blue_registration_id: 'r2' },
          { id: 'm2', red_registration_id: 'r3', blue_registration_id: null },
        ],
        error: null,
      });

      const regsChain = makeChain({ data: null, error: null });
      regsChain.in.mockResolvedValue({
        data: [
          // persons embed as object → "Given Family"
          { id: 'r1', persons: { given_name: 'Anna', family_name: 'Red', global_persons: null } },
          // persons embed as array with empty name → fall back to global display_name
          {
            id: 'r2',
            persons: [
              { given_name: '', family_name: '', global_persons: { display_name: 'Blue GP' } },
            ],
          },
          { id: 'r3', persons: { given_name: 'Cara', family_name: 'Solo', global_persons: null } },
        ],
        error: null,
      });

      fromMock.mockReturnValueOnce(matchesChain).mockReturnValueOnce(regsChain);

      const result = await (service as unknown as Resolver).fetchFighterNamesByMatch(['m1', 'm2']);

      expect(result.get('m1')).toEqual({ redName: 'Anna Red', blueName: 'Blue GP' });
      // Missing blue registration → null; red resolves normally.
      expect(result.get('m2')).toEqual({ redName: 'Cara Solo', blueName: null });
    });

    it('returns an empty map (and issues no query) when there are no matches', async () => {
      const result = await (service as unknown as Resolver).fetchFighterNamesByMatch([]);
      expect(result.size).toBe(0);
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('mapRefereeAssignments — test-event exclusion', () => {
    type Mapper = { mapRefereeAssignments: (rows: unknown[]) => RefereeAssignmentInput[] };

    // A completed match-scoped referee_assignments row, shaped like the embed in
    // fetchRefereeAssignmentsByPerson (matches → phases → tournaments → events).
    const assignmentRow = (over: { matchId: string; eventId: string; isTest: boolean }) => ({
      match_id: over.matchId,
      person_id: 'gp-1',
      role: 'arbitre_declarant',
      matches: {
        id: over.matchId,
        status: 'completed',
        scheduled_at: null,
        pool_id: null,
        bracket_slot_id: null,
        pools: null,
        bracket_slots: null,
        phases: {
          type: 'pool',
          config_json: null,
          tournaments: {
            id: 't1',
            name: 'Longsword',
            weapon: 'longsword',
            events: { id: over.eventId, name: 'Event', is_test_event: over.isTest },
          },
        },
      },
    });

    it('drops assignments in test events, so referee career stats never count them', () => {
      const rows = [
        assignmentRow({ matchId: 'm-real', eventId: 'e-real', isTest: false }),
        assignmentRow({ matchId: 'm-test', eventId: 'e-test', isTest: true }),
      ];

      const mapped = (service as unknown as Mapper).mapRefereeAssignments(rows);
      // The test-event assignment is dropped by the mapper (mirrors the fighter
      // career exclusion); only the real-event match survives.
      expect(mapped.map((a) => a.matchId)).toEqual(['m-real']);

      // …and it cascades to the derived stats: totalMatches/eventsWorked exclude it.
      const stats = buildRefereeStats({
        userId: 'gp-1',
        assignments: mapped,
        durations: [],
        penalties: [],
      });
      expect(stats.totalMatches).toBe(1);
      expect(stats.eventsWorked).toBe(1);
    });
  });
});

describe('parseBoolCell', () => {
  it('treats empty / missing values as false', () => {
    expect(parseBoolCell(undefined)).toBe(false);
    expect(parseBoolCell(null)).toBe(false);
    expect(parseBoolCell('')).toBe(false);
    expect(parseBoolCell('   ')).toBe(false);
  });

  it('parses numeric truthy / falsy', () => {
    expect(parseBoolCell('1')).toBe(true);
    expect(parseBoolCell('0')).toBe(false);
  });

  it('parses textual booleans case-insensitively', () => {
    expect(parseBoolCell('true')).toBe(true);
    expect(parseBoolCell('TRUE')).toBe(true);
    expect(parseBoolCell('True')).toBe(true);
    expect(parseBoolCell('false')).toBe(false);
    expect(parseBoolCell('FALSE')).toBe(false);
    expect(parseBoolCell('False')).toBe(false);
  });

  it('parses yes/no for spreadsheet ergonomics', () => {
    expect(parseBoolCell('yes')).toBe(true);
    expect(parseBoolCell('YES')).toBe(true);
    expect(parseBoolCell('no')).toBe(false);
    expect(parseBoolCell('NO')).toBe(false);
  });

  it('returns false for unrecognised values rather than leaking truthiness', () => {
    expect(parseBoolCell('maybe')).toBe(false);
    expect(parseBoolCell('2')).toBe(false);
    expect(parseBoolCell('-1')).toBe(false);
  });
});

// NOTE: tournament-placement decided-ness tests moved to
// `../tournament-placement/tournament-placement.service.test.ts` when the
// placement logic was extracted into the shared TournamentPlacementService.
