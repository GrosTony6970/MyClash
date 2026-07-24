import { describe, expect, it } from 'vitest';
import { aggregateClubStandings } from './league-club-standings';

function rankingRow(overrides: {
  fighter_id: string;
  total_points?: number;
  medal_count?: number;
  ranking_group_key?: string;
  club?: { id: string; name: string; city?: string | null } | null;
  display_name?: string;
}): Record<string, unknown> {
  const {
    fighter_id,
    total_points = 0,
    medal_count = 0,
    ranking_group_key = 'longsword',
    club,
    display_name,
  } = overrides;
  return {
    fighter_id,
    ranking_group_key,
    total_points,
    medal_count,
    global_persons: {
      display_name: display_name ?? `Fighter ${fighter_id}`,
      club_id: club?.id ?? null,
      clubs: club ? { id: club.id, name: club.name, city: club.city ?? null } : null,
    },
  };
}

describe('aggregateClubStandings', () => {
  it('sums member points per club and ranks clubs by total points', () => {
    const { clubs } = aggregateClubStandings([
      rankingRow({ fighter_id: 'a', total_points: 16, club: { id: 'lyon', name: 'Lyon AMHE' } }),
      rankingRow({ fighter_id: 'b', total_points: 13, club: { id: 'lyon', name: 'Lyon AMHE' } }),
      rankingRow({ fighter_id: 'c', total_points: 20, club: { id: 'paris', name: 'Paris HEMA' } }),
    ]);

    expect(clubs.map((c) => c.clubId)).toEqual(['lyon', 'paris']); // 29 vs 20
    expect(clubs[0]).toMatchObject({
      clubId: 'lyon',
      name: 'Lyon AMHE',
      totalPoints: 29,
      memberCount: 2,
    });
    expect(clubs[1]).toMatchObject({ clubId: 'paris', totalPoints: 20, memberCount: 1 });
  });

  it('counts each fighter once toward memberCount even across multiple ranking groups', () => {
    const { clubs } = aggregateClubStandings([
      rankingRow({
        fighter_id: 'a',
        total_points: 16,
        ranking_group_key: 'longsword',
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'a',
        total_points: 10,
        ranking_group_key: 'rapier',
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'b',
        total_points: 5,
        ranking_group_key: 'rapier',
        club: { id: 'lyon', name: 'Lyon' },
      }),
    ]);

    expect(clubs).toHaveLength(1);
    expect(clubs[0]).toMatchObject({ totalPoints: 31, memberCount: 2 });
    // Fighter a's two rows fold into one top-member entry with summed points.
    expect(clubs[0]!.topMembers[0]).toMatchObject({ fighterId: 'a', points: 26 });
  });

  it('sums medal counts per club', () => {
    const { clubs } = aggregateClubStandings([
      rankingRow({
        fighter_id: 'a',
        total_points: 10,
        medal_count: 2,
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'b',
        total_points: 10,
        medal_count: 1,
        club: { id: 'lyon', name: 'Lyon' },
      }),
    ]);
    expect(clubs[0]).toMatchObject({ medalCount: 3 });
  });

  it('breaks a points tie by member count, then by medal count', () => {
    const { clubs } = aggregateClubStandings([
      // Club A: 20 pts across 1 member, 3 medals.
      rankingRow({
        fighter_id: 'a1',
        total_points: 20,
        medal_count: 3,
        club: { id: 'A', name: 'Club A' },
      }),
      // Club B: 20 pts across 2 members, 0 medals → wins the tie on member count.
      rankingRow({
        fighter_id: 'b1',
        total_points: 10,
        medal_count: 0,
        club: { id: 'B', name: 'Club B' },
      }),
      rankingRow({
        fighter_id: 'b2',
        total_points: 10,
        medal_count: 0,
        club: { id: 'B', name: 'Club B' },
      }),
    ]);
    expect(clubs.map((c) => c.clubId)).toEqual(['B', 'A']);

    // Same points AND member count → medal count decides.
    const tieOnMedals = aggregateClubStandings([
      rankingRow({
        fighter_id: 'c1',
        total_points: 20,
        medal_count: 1,
        club: { id: 'C', name: 'Club C' },
      }),
      rankingRow({
        fighter_id: 'd1',
        total_points: 20,
        medal_count: 3,
        club: { id: 'D', name: 'Club D' },
      }),
    ]).clubs;
    expect(tieOnMedals.map((c) => c.clubId)).toEqual(['D', 'C']);
  });

  it('buckets club-less fighters into Unaffiliated, excluded from the ranked clubs', () => {
    const { clubs, unaffiliated } = aggregateClubStandings([
      rankingRow({ fighter_id: 'a', total_points: 16, club: { id: 'lyon', name: 'Lyon' } }),
      rankingRow({ fighter_id: 'x', total_points: 9, club: null }),
      rankingRow({ fighter_id: 'y', total_points: 4, club: null }),
    ]);
    expect(clubs.map((c) => c.clubId)).toEqual(['lyon']);
    expect(unaffiliated).toEqual({ totalPoints: 13, memberCount: 2, medalCount: 0 });
  });

  it('returns unaffiliated=null when every fighter has a club', () => {
    const { unaffiliated } = aggregateClubStandings([
      rankingRow({ fighter_id: 'a', total_points: 16, club: { id: 'lyon', name: 'Lyon' } }),
    ]);
    expect(unaffiliated).toBeNull();
  });

  it('limits topMembers to the three highest scorers, sorted by points', () => {
    const { clubs } = aggregateClubStandings([
      rankingRow({
        fighter_id: 'a',
        total_points: 5,
        display_name: 'Ann',
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'b',
        total_points: 16,
        display_name: 'Bob',
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'c',
        total_points: 10,
        display_name: 'Cy',
        club: { id: 'lyon', name: 'Lyon' },
      }),
      rankingRow({
        fighter_id: 'd',
        total_points: 8,
        display_name: 'Di',
        club: { id: 'lyon', name: 'Lyon' },
      }),
    ]);
    expect(clubs[0]!.topMembers.map((m) => m.name)).toEqual(['Bob', 'Cy', 'Di']);
  });

  it('normalizes an array-shaped embed (UNIQUE-fk flip) the same as an object', () => {
    const rows = [
      {
        fighter_id: 'a',
        total_points: 12,
        medal_count: 1,
        global_persons: [
          {
            display_name: 'Ann',
            club_id: 'lyon',
            clubs: [{ id: 'lyon', name: 'Lyon', city: 'Lyon' }],
          },
        ],
      },
    ];
    const { clubs } = aggregateClubStandings(rows);
    expect(clubs[0]).toMatchObject({ clubId: 'lyon', name: 'Lyon', city: 'Lyon', totalPoints: 12 });
  });
});
