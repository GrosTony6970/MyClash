/**
 * The readiness checklist of a team Tournament: its entrants are its teams, so "fewer than 2"
 * counts teams, under its own key (`teams`, worded in EN and FR) in place of `fighters`.
 *
 * Beside `event-readiness.test.ts`, which holds the other rules, for the 400-line file budget.
 */
import { describe, expect, it } from 'vitest';
import {
  computeEventReadiness,
  type ReadinessCheck,
  type ReadinessTournamentSnapshot,
} from './event-readiness';

/** A Tournament that passes every check, so each test varies its kind and its entrants. */
function tournament(
  overrides: Partial<ReadinessTournamentSnapshot> = {},
): ReadinessTournamentSnapshot {
  return {
    id: 't1',
    name: 'Team Longsword',
    rulesetCode: 'TF_v1',
    activeFighterCount: 0,
    entrantKind: 'team',
    teamCount: 4,
    hasPoolPhase: true,
    hasSwissPhase: false,
    hasElimPhase: false,
    poolCount: 1,
    swissRoundCount: 0,
    poolsWithoutReferee: 0,
    poolMatchCount: 6,
    unscheduledPoolMatchCount: 0,
    ...overrides,
  };
}

const roster = {
  activeFighterCount: 0,
  withoutClub: 0,
  withoutRatingsId: 0,
  withoutGlobalIdentity: 0,
};

function entrantChecks(overrides: Partial<ReadinessTournamentSnapshot>): ReadinessCheck[] {
  const { checks } = computeEventReadiness({
    liceCount: 1,
    tournaments: [tournament(overrides)],
    roster,
  });
  return checks.filter((check) => check.key === 'teams' || check.key === 'fighters');
}

describe('computeEventReadiness — teams', () => {
  it.each([
    [0, 'critical'],
    [1, 'critical'],
    [2, 'ok'],
    [3, 'ok'],
  ])('reports %i teams as %s', (teamCount, level) => {
    expect(entrantChecks({ teamCount })).toEqual([
      { key: 'teams', level, values: { count: teamCount }, tournamentId: 't1' },
    ]);
  });

  it('reads the fighters of an individual Tournament, whatever teams it is said to hold', () => {
    expect(
      entrantChecks({ entrantKind: 'individual', teamCount: 5, activeFighterCount: 1 }),
    ).toEqual([{ key: 'fighters', level: 'critical', values: { count: 1 }, tournamentId: 't1' }]);
  });
});
