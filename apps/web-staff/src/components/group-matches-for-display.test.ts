import { describe, expect, it } from 'vitest';
import { groupMatchesForDisplay, needsTournamentHeadings } from './group-matches-for-display';
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
  weapon: 'sidesword',
  phaseType: 'pool',
  scoringConfig: null,
  referees: [],
  ...over,
});

describe('groupMatchesForDisplay', () => {
  it('returns one group per tournament, in first-appearance order', () => {
    const groups = groupMatchesForDisplay([
      match({ id: 'a', tournamentId: 't1', tournamentName: 'Sidesword' }),
      match({ id: 'b', tournamentId: 't2', tournamentName: 'Longsword' }),
      match({ id: 'c', tournamentId: 't1' }),
    ]);
    expect(groups.map((g) => g.tournamentId)).toEqual(['t1', 't2']);
    expect(groups[0]?.matches.map((m) => m.id)).toEqual(['a', 'c']);
    expect(groups[1]?.tournamentName).toBe('Longsword');
  });

  it('preserves schedule order inside each group', () => {
    const groups = groupMatchesForDisplay([
      match({ id: 'a', tournamentId: 't1' }),
      match({ id: 'b', tournamentId: 't1' }),
      match({ id: 'c', tournamentId: 't1' }),
    ]);
    expect(groups[0]?.matches.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps matches with no tournament, in a trailing null bucket', () => {
    // The sibling grouper DROPS these because it drives fetches. A display list
    // that dropped them would hide a bout the operator still has to score.
    const groups = groupMatchesForDisplay([
      match({ id: 'orphan', tournamentId: null, tournamentName: null }),
      match({ id: 'a', tournamentId: 't1' }),
    ]);
    expect(groups.map((g) => g.tournamentId)).toEqual(['t1', null]);
    expect(groups[1]?.matches.map((m) => m.id)).toEqual(['orphan']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupMatchesForDisplay([])).toEqual([]);
  });

  it('names a group from the first match that carries a name', () => {
    const groups = groupMatchesForDisplay([
      match({ id: 'a', tournamentId: 't1', tournamentName: 'Sidesword' }),
      match({ id: 'b', tournamentId: 't1', tournamentName: 'Renamed mid-list' }),
    ]);
    expect(groups[0]?.tournamentName).toBe('Sidesword');
  });
});

describe('needsTournamentHeadings', () => {
  it('is false for zero or one group — a lone heading is pure noise', () => {
    expect(needsTournamentHeadings([])).toBe(false);
    expect(needsTournamentHeadings(groupMatchesForDisplay([match()]))).toBe(false);
  });

  it('is true as soon as a second group exists', () => {
    const groups = groupMatchesForDisplay([
      match({ id: 'a', tournamentId: 't1' }),
      match({ id: 'b', tournamentId: 't2' }),
    ]);
    expect(needsTournamentHeadings(groups)).toBe(true);
  });

  it('counts the orphan bucket as a group', () => {
    const groups = groupMatchesForDisplay([
      match({ id: 'a', tournamentId: 't1' }),
      match({ id: 'orphan', tournamentId: null }),
    ]);
    expect(needsTournamentHeadings(groups)).toBe(true);
  });
});
