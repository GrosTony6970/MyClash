import { describe, expect, it, vi } from 'vitest';
import type { Ruleset } from '@myclash/rulesets';
import { poolScoresByRegistration } from './ruleset-scores';

/**
 * The ruleset's own `score` column for a Pool of teams: the engine is handed each team and each
 * side by its side key (ADR-022), never a Registration id, which a team bout leaves null.
 */
describe('poolScoresByRegistration — a Pool of teams', () => {
  it('hands the ruleset the teams and the sides of each bout by side key', () => {
    const scorePoolFighters = vi.fn(() => new Map<string, number>());
    const ruleset = { code: 'TF_v1', version: '1.0.0', scorePoolFighters } as unknown as Ruleset;
    const team = (id: string) => ({
      registration_id: null,
      team_id: id,
      registrations: null,
      teams: { id, name: id, color: null, logo_url: null },
    });

    poolScoresByRegistration(
      ruleset,
      [team('team-lyon'), team('team-paris')],
      [
        {
          id: 'm-1',
          red_registration_id: null,
          blue_registration_id: null,
          red_team_id: 'team-lyon',
          blue_team_id: 'team-paris',
          red_score: 5,
          blue_score: 3,
          winner_registration_id: null,
          winner_team_id: 'team-lyon',
          end_reason: null,
        },
        {
          // A side not known yet scores for nobody.
          id: 'm-2',
          red_registration_id: null,
          blue_registration_id: null,
          red_team_id: 'team-lyon',
          blue_team_id: null,
          red_score: 0,
          blue_score: 0,
          winner_registration_id: null,
          winner_team_id: null,
          end_reason: null,
        },
      ],
      new Map(),
      'full',
      {},
    );

    expect(scorePoolFighters.mock.calls).toEqual([
      [
        {
          entrantIds: ['team-lyon', 'team-paris'],
          completedMatches: [
            {
              id: 'm-1',
              redSideId: 'team-lyon',
              blueSideId: 'team-paris',
              winnerSideId: 'team-lyon',
              endReason: null,
              redScore: 5,
              blueScore: 3,
              exchanges: [],
            },
          ],
          afterblowMode: 'full',
          config: {},
        },
      ],
    ]);
  });
});
