import { describe, expect, it } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { BOUT, HALTED, setup } from './clock-late-press.fixtures';
import { isLevelBout, timeLimitResult } from './time-limit-result';

/**
 * A team bout ended on the clock (slice 1b-2).
 *
 * Lyon Blades (red) leads Nantes Rapières (blue) 3 - 1 in a team Pool when the time runs out. A
 * team bout has no Registration on either side: each side is a team (0282). The End read the
 * sides by Registration only, so it saw two empty sides and wrote a winner of nobody, a draw.
 * It now reads each side by its key (`sideKey`) and writes the leader into `winner_team_id`.
 */
const TEAMS = {
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-red',
  blue_team_id: 'team-blue',
  winner_registration_id: null,
  winner_team_id: null,
};

/** The bout's copy of its rules (0229): no format set, so a single bout of 90 seconds. */
const bout = (over: Record<string, unknown> = {}) => ({
  ...TEAMS,
  status: 'running',
  red_score: 3,
  blue_score: 1,
  match_number_label: 'L1-P1-M1',
  phases: { type: 'pool' },
  match_rules: { ruleset_config: {}, scoring_config_json: {} },
  ...over,
});

describe('timeLimitResult on a team bout', () => {
  it('names the red team, not a draw', () => {
    expect(timeLimitResult(bout(), 0, 0)).toEqual({
      complete: {
        winner_registration_id: null,
        winner_team_id: 'team-red',
        end_reason: 'time_limit',
      },
    });
  });

  it('names the blue team when blue leads', () => {
    expect(timeLimitResult(bout({ red_score: 1, blue_score: 4 }), 0, 0)).toEqual({
      complete: {
        winner_registration_id: null,
        winner_team_id: 'team-blue',
        end_reason: 'time_limit',
      },
    });
  });

  it('still names a Fighter into the Registration column, and clears the team column', () => {
    const individual = bout({
      red_registration_id: 'reg-red',
      blue_registration_id: 'reg-blue',
      red_team_id: null,
      blue_team_id: null,
    });

    expect(timeLimitResult(individual, 0, 0)).toEqual({
      complete: {
        winner_registration_id: 'reg-red',
        winner_team_id: null,
        end_reason: 'time_limit',
      },
    });
  });
});

describe('isLevelBout on a team bout', () => {
  it('is not level when a team leads on the board', () => {
    expect(isLevelBout(bout())).toBe(false);
  });

  it('is not level at 2 - 2 when a team is the recorded winner', () => {
    expect(isLevelBout(bout({ red_score: 2, blue_score: 2, winner_team_id: 'team-blue' }))).toBe(
      false,
    );
  });

  it('is level at 2 - 2 with no recorded winner', () => {
    expect(isLevelBout(bout({ red_score: 2, blue_score: 2 }))).toBe(true);
  });
});

describe('the End of a team bout, through the clock', () => {
  it('completes the bout with the leading team as its winner', async () => {
    const { db, clock } = setup(HALTED, TEAMS);

    await clock.clockAction(BOUT, 'end');

    const [write] = writesTo(db, 'matches');
    expect(write?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      winner_team_id: 'team-red',
      end_reason: 'time_limit',
    });
    expect(selectsFor(db.service.from, 'matches')[0]).toBe(
      'id, status, locked_at, started_at, match_rules_id, earlier_rules_ids, rounds_json, ' +
        'current_round, red_registration_id, blue_registration_id, red_team_id, blue_team_id, ' +
        'winner_registration_id, winner_team_id, red_score, blue_score, match_number_label, ' +
        'awaiting_round_advance, back_in_play_at, phases(type, tournaments(events(status))), ' +
        'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)',
    );
  });
});
