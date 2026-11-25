import { describe, expect, it } from 'vitest';
import { poolBoutWinner, type PoolBoutResult } from './pool-bout-winner';

const individual = (over: Partial<PoolBoutResult>): PoolBoutResult => ({
  status: 'completed',
  red_registration_id: 'reg-anna',
  blue_registration_id: 'reg-ben',
  red_team_id: null,
  blue_team_id: null,
  red_score: 5,
  blue_score: 3,
  winner_registration_id: null,
  winner_team_id: null,
  ...over,
});

const team = (over: Partial<PoolBoutResult>): PoolBoutResult => ({
  ...individual({}),
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-lyon',
  blue_team_id: 'team-paris',
  ...over,
});

describe('poolBoutWinner', () => {
  it('names the team that won by forfeit while behind on points, not the points leader', () => {
    // Lyon leads 5-3; Paris is awarded the bout (a forfeit by Lyon).
    expect(poolBoutWinner(team({ winner_team_id: 'team-paris' }))).toBe('blue');
  });

  it('names the Fighter that won by forfeit while behind on points', () => {
    expect(poolBoutWinner(individual({ winner_registration_id: 'reg-ben' }))).toBe('blue');
  });

  it('falls back to the scores for a team bout with no recorded winner (time limit)', () => {
    expect(poolBoutWinner(team({}))).toBe('red');
  });

  it('names no winner before the bout is completed', () => {
    expect(poolBoutWinner(team({ status: 'pending', winner_team_id: 'team-paris' }))).toBeNull();
  });
});
