import { describe, expect, it } from 'vitest';
import { groupLiceMatchesByTournament } from './lice-tournament-context';
import type { LiceMatch } from './lice-match-types';

const match = (over: Partial<LiceMatch> = {}): LiceMatch => ({
  id: 'm1',
  status: 'scheduled',
  poolId: null,
  scheduledAt: '2026-08-04T13:00:00Z',
  matchNumberLabel: 'M1',
  roundCode: 'SDW-P1-M1',
  redFighterName: 'Red',
  blueFighterName: 'Blue',
  redScore: 0,
  blueScore: 0,
  tournamentId: 't1',
  tournamentName: 'Sidesword',
  phaseType: 'pool',
  scoringConfig: null,
  referees: [],
  ...over,
});

describe('groupLiceMatchesByTournament', () => {
  it('returns one entry per tournament, in first-appearance order', () => {
    // The tournament running now appears first in the schedule, so it must
    // sort first — the operator should never scroll to find it.
    const result = groupLiceMatchesByTournament([
      match({ id: 'a', tournamentId: 't1', tournamentName: 'Sidesword' }),
      match({ id: 'b', tournamentId: 't2', tournamentName: 'Longsword' }),
      match({ id: 'c', tournamentId: 't1' }),
    ]);
    expect(result.map((t) => t.tournamentId)).toEqual(['t1', 't2']);
    expect(result[0]?.matchIds).toEqual(['a', 'c']);
    expect(result[1]?.tournamentName).toBe('Longsword');
  });

  it('flags pools when any of this licess matches sits in one', () => {
    const result = groupLiceMatchesByTournament([
      match({ id: 'a', poolId: null, phaseType: 'single_elim' }),
      match({ id: 'b', poolId: 'p1', phaseType: 'pool' }),
    ]);
    expect(result[0]).toMatchObject({ hasPools: true, hasBracket: true });
  });

  it('does not offer a bracket for a pool-only tournament', () => {
    const result = groupLiceMatchesByTournament([match({ poolId: 'p1', phaseType: 'pool' })]);
    expect(result[0]).toMatchObject({ hasPools: true, hasBracket: false });
  });

  it('counts double elimination as a bracket', () => {
    const result = groupLiceMatchesByTournament([match({ phaseType: 'double_elim' })]);
    expect(result[0]?.hasBracket).toBe(true);
  });

  it('does not treat swiss as a bracket', () => {
    const result = groupLiceMatchesByTournament([match({ phaseType: 'swiss', poolId: null })]);
    expect(result[0]).toMatchObject({ hasPools: false, hasBracket: false });
  });

  it('drops matches with no tournament id — nothing could be fetched for them', () => {
    const result = groupLiceMatchesByTournament([
      match({ id: 'a', tournamentId: null }),
      match({ id: 'b', tournamentId: 't1' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.matchIds).toEqual(['b']);
  });

  it('returns an empty list for no matches', () => {
    expect(groupLiceMatchesByTournament([])).toEqual([]);
  });
});
