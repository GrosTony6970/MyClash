import { describe, expect, it, vi } from 'vitest';
import { PoolGeneratorService } from './pool-generator';

function makeRegistrationsChain(data: unknown[]) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function makeTournamentChain(weapon: string | null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { weapon }, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

describe('PoolGeneratorService HEMA Ratings seeding', () => {
  it('uses same-weapon weighted rating as skillRating for snake seeding', async () => {
    // Post-0083: hema_ratings_id is nested under persons.global_persons,
    // matching the rewritten embed `persons(club_id, global_persons(hema_ratings_id))`.
    const registrations = [
      {
        id: 'r1',
        seed: 1,
        bib_number: null,
        persons: { club_id: 'club-a', global_persons: { hema_ratings_id: 'hr-low' } },
      },
      {
        id: 'r2',
        seed: 2,
        bib_number: null,
        persons: { club_id: 'club-b', global_persons: { hema_ratings_id: 'hr-high' } },
      },
      {
        id: 'r3',
        seed: 3,
        bib_number: null,
        persons: { club_id: 'club-c', global_persons: { hema_ratings_id: 'hr-mid' } },
      },
      {
        id: 'r4',
        seed: 4,
        bib_number: null,
        persons: { club_id: 'club-d', global_persons: { hema_ratings_id: null } },
      },
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(makeRegistrationsChain(registrations))
      .mockReturnValueOnce(makeTournamentChain('Longsword'));
    const hemaRatings = {
      resolveWeightedRatings: vi.fn().mockResolvedValue(
        new Map([
          ['hr-low', 1100],
          ['hr-high', 1900],
          ['hr-mid', 1500],
        ]),
      ),
    };
    const service = new PoolGeneratorService({ service: { from } } as never, hemaRatings as never);

    const result = await service.generatePools({
      tournamentId: 'tournament-1',
      poolCount: 2,
      settings: {
        enforceSchoolSeparation: false,
        schoolSeparationStrictness: 'soft',
        enforceSkillBalance: false,
      },
      seed: 1,
    });

    expect(hemaRatings.resolveWeightedRatings).toHaveBeenCalledWith(
      ['hr-low', 'hr-high', 'hr-mid'],
      'Longsword',
    );
    expect(result.pools[0]?.registrationIds).toEqual(['r2', 'r4']);
    expect(result.pools[1]?.registrationIds).toEqual(['r3', 'r1']);
  });
});
