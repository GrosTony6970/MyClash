import { describe, expect, it, vi } from 'vitest';
import type { RankingSlot } from '@myclash/types';
import type { BracketSideWire } from '@myclash/types/bracket-side';
import { TournamentPlacementService } from './tournament-placement.service';

/** A Fighter's side of a slot, keyed by its Registration; or a team's, keyed by the team. */
const side = (id: string, kind: BracketSideWire['kind'] = 'individual'): BracketSideWire => ({
  sideId: id,
  kind,
  registrationId: kind === 'individual' ? id : null,
  teamId: kind === 'team' ? id : null,
  name: id,
  clubAbbrev: null,
  colour: kind === 'team' ? 'green' : null,
});

/** A bout of the bracket, as the bracket read sends the fields the ranking reads. */
const bout = (
  id: string,
  [round, position]: [number, number],
  [red, blue]: [BracketSideWire, BracketSideWire],
  [redScore, blueScore]: [number, number],
  winner: string | null,
): RankingSlot => ({
  id,
  round,
  position,
  status: winner ? 'completed' : 'running',
  redSideId: red.sideId,
  blueSideId: blue.sideId,
  winnerSideId: winner,
  red,
  blue,
  redScore,
  blueScore,
});

/**
 * The shared placement authority. These moved here from fighters.service.test
 * when the logic was extracted, and gain the correctness case that motivated the
 * extraction: a bracketed tournament's placement follows the BRACKET, never a
 * flat wins-count or pool score — the exact bug league scoring used to have.
 */
describe('TournamentPlacementService', () => {
  const registrationId = 'reg-1';

  /** Bracket slot for a Final at round 2; `winner` null = not decided yet. */
  const finalSlot = (winner: string | null) =>
    bout(
      'slot-final',
      [2, 1],
      [side(registrationId), side('reg-2')],
      winner ? [5, 2] : [1, 1],
      winner,
    );

  const standings = {
    rows: [
      { entrantId: registrationId, displayName: 'Me', rank: 1, club: null, stats: { score: 9 } },
      { entrantId: 'reg-2', displayName: 'Them', rank: 2, club: null, stats: { score: 3 } },
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
    return result.byEntrantId.get(regId) ?? null;
  };

  it('awards no placement while the bracket final is undecided', async () => {
    // Leading the pools does NOT make you the champion — the final can still
    // knock you out. Falling back to pool rank here would hand out a gold medal.
    const service = makeService({ slots: [finalSlot(null)], openMatches: 1 });
    const result = await service.getTournamentPlacements('tournament-1');
    expect(result.decided).toBe(false);
    expect(result.byEntrantId.size).toBe(0);
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
    expect(result.byEntrantId.size).toBe(0);
  });

  it('follows the bracket, not the pool score, when placing a full field', async () => {
    // 4-fighter bracket. Semis: A beats B, D beats C. Final: D beats A. Bronze:
    // B beats C. So the podium is D(1) / A(2) / B(3) / C(4). Pool scores are the
    // INVERSE (A highest) — proving placement is the bracket, not the pools and
    // not a flat wins-count (A won 1 semi, D won the final; a wins-sort could tie
    // or mis-order them). This is exactly what league scoring got wrong.
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => side(id));
    const slots = [
      bout('sf1', [1, 1], [a!, b!], [5, 3], 'A'),
      bout('sf2', [1, 2], [c!, d!], [2, 5], 'D'),
      bout('final', [2, 1], [a!, d!], [3, 5], 'D'),
      bout('bronze', [2, 2], [b!, c!], [5, 4], 'B'),
    ];
    const standingsRows = {
      rows: [
        { entrantId: 'A', displayName: 'A', rank: 1, club: null, stats: { score: 10 } },
        { entrantId: 'B', displayName: 'B', rank: 2, club: null, stats: { score: 8 } },
        { entrantId: 'C', displayName: 'C', rank: 3, club: null, stats: { score: 6 } },
        { entrantId: 'D', displayName: 'D', rank: 4, club: null, stats: { score: 4 } },
      ],
    };
    const service = makeService({ slots, openMatches: 0, standingsRows });
    const result = await service.getTournamentPlacements('tournament-1');

    expect(result.decided).toBe(true);
    expect(result.byEntrantId.get('D')).toMatchObject({ place: 1, resultKind: 'champion' });
    expect(result.byEntrantId.get('A')).toMatchObject({ place: 2, resultKind: 'runnerUp' });
    expect(result.byEntrantId.get('B')).toMatchObject({ place: 3, resultKind: 'third' });
    expect(result.byEntrantId.get('C')).toMatchObject({ place: 4, resultKind: 'fourth' });
    // Full field ranked, ordered by place.
    expect(result.ordered.map((e) => e.entrantId)).toEqual(['D', 'A', 'B', 'C']);
    expect(result.ordered.every((e) => e.totalRanked === 4)).toBe(true);
  });

  it('places a team bracket by team, the final won on a forfeit with the lower score', async () => {
    // Four teams. Lyon led the final 5-3 and forfeited: Rome is the recorded winner. Paris beat
    // Oslo in the bronze bout. A team side has no Registration: only its side key ranks it.
    const [lyon, paris, rome, oslo] = ['lyon', 'paris', 'rome', 'oslo'].map((id) =>
      side(id, 'team'),
    );
    const slots = [
      bout('sf1', [1, 1], [lyon!, paris!], [5, 2], 'lyon'),
      bout('sf2', [1, 2], [rome!, oslo!], [5, 4], 'rome'),
      bout('final', [2, 1], [lyon!, rome!], [5, 3], 'rome'),
      bout('bronze', [2, 2], [paris!, oslo!], [5, 3], 'paris'),
    ];
    const team = (entrantId: string, rank: number) => ({
      entrantId,
      kind: 'team',
      colour: 'green',
      displayName: entrantId,
      rank,
      club: null,
      stats: { score: 0 },
    });
    const standingsRows = {
      rows: [team('lyon', 1), team('paris', 2), team('rome', 3), team('oslo', 4)],
    };
    const service = makeService({ slots, openMatches: 0, standingsRows });
    const result = await service.getTournamentPlacements('tournament-1');

    expect(result.ordered.map((e) => [e.entrantId, e.resultKind])).toEqual([
      ['rome', 'champion'],
      ['lyon', 'runnerUp'],
      ['paris', 'third'],
      ['oslo', 'fourth'],
    ]);
    expect(result.byEntrantId.get('rome')).toMatchObject({ place: 1, totalRanked: 4 });
  });
});
