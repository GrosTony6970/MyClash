import { describe, expect, it, vi } from 'vitest';
import { TournamentPlacementService } from './tournament-placement.service';

/**
 * The shared placement authority. These moved here from fighters.service.test
 * when the logic was extracted, and gain the correctness case that motivated the
 * extraction: a bracketed tournament's placement follows the BRACKET, never a
 * flat wins-count or pool score — the exact bug league scoring used to have.
 */
describe('TournamentPlacementService', () => {
  const registrationId = 'reg-1';

  /** Bracket slot for a Final at round 2; `winner` null = not decided yet. */
  const finalSlot = (winner: string | null) => ({
    id: 'slot-final',
    round: 2,
    position: 1,
    status: winner ? 'completed' : 'running',
    redRegistrationId: registrationId,
    blueRegistrationId: 'reg-2',
    redFighterName: 'Me',
    blueFighterName: 'Them',
    redClubAbbrev: null,
    blueClubAbbrev: null,
    redScore: winner ? 5 : 1,
    blueScore: winner ? 2 : 1,
    winnerRegistrationId: winner,
  });

  const standings = {
    rows: [
      { registrationId, displayName: 'Me', rank: 1, club: null, stats: { score: 9 } },
      { registrationId: 'reg-2', displayName: 'Them', rank: 2, club: null, stats: { score: 3 } },
    ],
  };

  function makeService(opts: { slots: unknown[]; openMatches: number; standingsRows?: unknown }) {
    const countChain = { select: vi.fn(), eq: vi.fn(), not: vi.fn() };
    countChain.select.mockReturnValue(countChain);
    countChain.eq.mockReturnValue(countChain);
    // `.not()` is the last link in isTournamentFullyPlayed's chain — it awaits.
    countChain.not.mockResolvedValue({ count: opts.openMatches, error: null });

    const supabase = { service: { from: vi.fn().mockReturnValue(countChain) }, anon: {} };
    const phases = { getTournamentBracket: vi.fn().mockResolvedValue({ slots: opts.slots }) };
    const poolStandings = {
      getPoolStandings: vi.fn().mockResolvedValue(opts.standingsRows ?? standings),
    };
    return new TournamentPlacementService(
      supabase as never,
      phases as never,
      poolStandings as never,
    );
  }

  const placementFor = async (
    service: TournamentPlacementService,
    regId = registrationId,
  ): Promise<{ place: number; resultKind: string } | null> => {
    const result = await service.getTournamentPlacements('tournament-1');
    return result.byRegistrationId.get(regId) ?? null;
  };

  it('awards no placement while the bracket final is undecided', async () => {
    // Leading the pools does NOT make you the champion — the final can still
    // knock you out. Falling back to pool rank here would hand out a gold medal.
    const service = makeService({ slots: [finalSlot(null)], openMatches: 1 });
    const result = await service.getTournamentPlacements('tournament-1');
    expect(result.decided).toBe(false);
    expect(result.byRegistrationId.size).toBe(0);
  });

  it('awards no placement when the final has no match row yet', async () => {
    // The sharp edge: the final's slot exists but its match hasn't been created,
    // so NOTHING is open — yet the tournament is undecided. Only the bracket
    // check stands between the pool leader and an unearned gold.
    const service = makeService({ slots: [finalSlot(null)], openMatches: 0 });
    await expect(placementFor(service)).resolves.toBeNull();
  });

  it('awards the placement once the bracket final is decided', async () => {
    const service = makeService({ slots: [finalSlot(registrationId)], openMatches: 0 });
    await expect(placementFor(service)).resolves.toMatchObject({
      place: 1,
      resultKind: 'champion',
    });
  });

  it('awards the pool rank for a pool-only tournament with every match played', async () => {
    const service = makeService({ slots: [], openMatches: 0 });
    await expect(placementFor(service)).resolves.toMatchObject({ place: 1, resultKind: 'pool' });
  });

  it('awards nothing for a pool-only tournament still in play', async () => {
    const service = makeService({ slots: [], openMatches: 3 });
    const result = await service.getTournamentPlacements('tournament-1');
    expect(result.decided).toBe(false);
    expect(result.byRegistrationId.size).toBe(0);
  });

  it('follows the bracket, not the pool score, when placing a full field', async () => {
    // 4-fighter bracket. Semis: A beats B, D beats C. Final: D beats A. Bronze:
    // B beats C. So the podium is D(1) / A(2) / B(3) / C(4). Pool scores are the
    // INVERSE (A highest) — proving placement is the bracket, not the pools and
    // not a flat wins-count (A won 1 semi, D won the final; a wins-sort could tie
    // or mis-order them). This is exactly what league scoring got wrong.
    const slots = [
      // Semi-finals (round 1)
      {
        id: 'sf1',
        round: 1,
        position: 1,
        status: 'completed',
        redRegistrationId: 'A',
        blueRegistrationId: 'B',
        redFighterName: 'A',
        blueFighterName: 'B',
        redClubAbbrev: null,
        blueClubAbbrev: null,
        redScore: 5,
        blueScore: 3,
        winnerRegistrationId: 'A',
      },
      {
        id: 'sf2',
        round: 1,
        position: 2,
        status: 'completed',
        redRegistrationId: 'C',
        blueRegistrationId: 'D',
        redFighterName: 'C',
        blueFighterName: 'D',
        redClubAbbrev: null,
        blueClubAbbrev: null,
        redScore: 2,
        blueScore: 5,
        winnerRegistrationId: 'D',
      },
      // Final (round 2, position 1)
      {
        id: 'final',
        round: 2,
        position: 1,
        status: 'completed',
        redRegistrationId: 'A',
        blueRegistrationId: 'D',
        redFighterName: 'A',
        blueFighterName: 'D',
        redClubAbbrev: null,
        blueClubAbbrev: null,
        redScore: 3,
        blueScore: 5,
        winnerRegistrationId: 'D',
      },
      // Bronze (round 2, position 2)
      {
        id: 'bronze',
        round: 2,
        position: 2,
        status: 'completed',
        redRegistrationId: 'B',
        blueRegistrationId: 'C',
        redFighterName: 'B',
        blueFighterName: 'C',
        redClubAbbrev: null,
        blueClubAbbrev: null,
        redScore: 5,
        blueScore: 4,
        winnerRegistrationId: 'B',
      },
    ];
    const standingsRows = {
      rows: [
        { registrationId: 'A', displayName: 'A', rank: 1, club: null, stats: { score: 10 } },
        { registrationId: 'B', displayName: 'B', rank: 2, club: null, stats: { score: 8 } },
        { registrationId: 'C', displayName: 'C', rank: 3, club: null, stats: { score: 6 } },
        { registrationId: 'D', displayName: 'D', rank: 4, club: null, stats: { score: 4 } },
      ],
    };
    const service = makeService({ slots, openMatches: 0, standingsRows });
    const result = await service.getTournamentPlacements('tournament-1');

    expect(result.decided).toBe(true);
    expect(result.byRegistrationId.get('D')).toMatchObject({ place: 1, resultKind: 'champion' });
    expect(result.byRegistrationId.get('A')).toMatchObject({ place: 2, resultKind: 'runnerUp' });
    expect(result.byRegistrationId.get('B')).toMatchObject({ place: 3, resultKind: 'third' });
    expect(result.byRegistrationId.get('C')).toMatchObject({ place: 4, resultKind: 'fourth' });
    // Full field ranked, ordered by place.
    expect(result.ordered.map((e) => e.registrationId)).toEqual(['D', 'A', 'B', 'C']);
    expect(result.ordered.every((e) => e.totalRanked === 4)).toBe(true);
  });
});
