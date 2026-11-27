import { describe, expect, it } from 'vitest';
import type { MatchProtest } from '../types/match-events';
import { liveProtestsOf, protestAtLimit, protestChipText } from './protest-chip';

describe('liveProtestsOf', () => {
  const row = (id: string, registrationId: string, voided = false) =>
    ({ id, registration_id: registrationId, voided }) as MatchProtest;

  it('keeps the Fighter’s protests that are not voided', () => {
    const rows = [row('a', 'red'), row('b', 'red', true), row('c', 'blue'), row('d', 'red')];
    expect(liveProtestsOf(rows, 'red').map((p) => p.id)).toEqual(['a', 'd']);
    expect(liveProtestsOf(rows, 'blue').map((p) => p.id)).toEqual(['c']);
  });

  // A side waiting for a Fighter has no key: null is nobody (`isRowOfSide`).
  it('keeps a protest with no side off the chip of a side with none', () => {
    const row = { id: 'pr-1', registration_id: null, team_id: null, voided: false };
    expect(liveProtestsOf([row as MatchProtest], null)).toEqual([]);
  });

  // A team protest names its team, with no Registration: each team's chip counts its own.
  it('counts the protests of each team on its own chip', () => {
    const team = (id: string, teamId: string, voided = false) =>
      ({ id, registration_id: null, team_id: teamId, voided }) as MatchProtest;
    const rows = [team('a', 'team-red'), team('b', 'team-blue'), team('c', 'team-red')];
    expect(liveProtestsOf(rows, 'team-red').map((p) => p.id)).toEqual(['a', 'c']);
    expect(liveProtestsOf(rows, 'team-blue').map((p) => p.id)).toEqual(['b']);
    expect(liveProtestsOf([...rows, team('d', 'team-blue', true)], 'team-blue')).toHaveLength(1);
  });
});

describe('protestChipText', () => {
  it('shows the count alone when the Tournament has no limit', () => {
    expect(protestChipText(2, null)).toBe('2');
  });

  it('shows the count over the limit when the Tournament has one', () => {
    expect(protestChipText(2, 2)).toBe('2/2');
    expect(protestChipText(0, 0)).toBe('0/0');
  });
});

describe('protestAtLimit', () => {
  it('is true at the limit and past it', () => {
    expect(protestAtLimit(2, 2)).toBe(true);
    expect(protestAtLimit(3, 2)).toBe(true);
  });

  it('is false under the limit, and with no limit', () => {
    expect(protestAtLimit(1, 2)).toBe(false);
    expect(protestAtLimit(5, null)).toBe(false);
  });
});
