import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  builtIn,
  MATCH_SELECT,
  RULES,
  SNAPSHOT_SELECT,
  stamped,
  teamBout,
  written,
} from './match-forfeits.team.fixtures';

/**
 * A team forfeits one Match as a whole (ADR-022; calls 1, 4, 8 and 13 of the 1b-2 plan). The score
 * is the penalty ruleset's; nothing of the Fighter part runs (no inheritance, no escalation, no
 * reserve, no status settle); the bout is handed to the completion owner by the forfeit itself.
 * The harness is `match-forfeits.team.fixtures.ts`; the resends and the take-back are
 * `match-forfeits.team-retry.test.ts`.
 */

describe('a team forfeits a Pool Match as a whole', () => {
  it('writes the team columns, the winner team and the ruleset score', async () => {
    const { db, forfeit } = teamBout();
    await forfeit();

    expect(written(db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({
        match_id: 'm1',
        forfeiting_registration_id: null,
        forfeiting_team_id: 'team-red',
        winner_registration_id: null,
        winner_team_id: 'team-blue',
        score_policy: 'fixed_loss',
        forfeiting_score: 0,
        opponent_score: 9,
        previous_match_state: {
          status: 'running',
          red_score: 2,
          blue_score: 3,
          winner_registration_id: null,
          winner_team_id: null,
          ended_at: null,
          end_reason: null,
        },
      }),
    ]);
    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'completed',
        winner_registration_id: null,
        winner_team_id: 'team-blue',
        red_score: 0,
        blue_score: 9,
        end_reason: 'forfeit',
      }),
    ]);
    expect(stamped(db, 'ff-m1')).toHaveLength(1);
    expect(selectsFor(db.from, 'matches')).toEqual([MATCH_SELECT, SNAPSHOT_SELECT]);
  });

  it('the blue team forfeiting gives the Match to the red team', async () => {
    const { db, forfeit } = teamBout();
    await forfeit({ forfeitingTeamId: 'team-blue' });
    expect(written(db, 'matches', 'update')[0]).toMatchObject({
      winner_team_id: 'team-red',
      red_score: 9,
      blue_score: 0,
    });
  });

  it('runs no Fighter part: no inheritance, no escalation, the team continues', async () => {
    // The rules withdraw a Fighter, and disqualify one before their 1st bout and after 1 forfeit.
    const { db, forfeit } = teamBout();
    await forfeit();
    expect(written(db, 'match_forfeits', 'insert')[0]).toMatchObject({
      parent_forfeit_id: null,
      under_out_status: false,
      can_continue: true,
      fighter_outcome: null,
    });
    // Only its own record's read: no forfeits of a Fighter, no Registration, no status.
    expect(selectsFor(db.from, 'match_forfeits')).toEqual(['*', '*']);
  });

  it('settles nobody and hands its bout to the completion owner itself (call 13)', async () => {
    const { db, completion, forfeit } = teamBout();
    await forfeit();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('takes the penalty ruleset’s own rules, never the Tournament’s stored changes (call 1)', async () => {
    const { db, forfeit } = teamBout({
      changes: { reasons: { voluntary: { opponentScore: 4 } } },
    });
    await forfeit();
    expect(written(db, 'match_forfeits', 'insert')[0]).toMatchObject({ opponent_score: 9 });
  });

  it('a draw names no winner team', async () => {
    const draw = { outcome: 'draw', opponentScore: 6, fighter: 'continues' } as const;
    const { db, forfeit } = teamBout({
      more: {
        penalty_rulesets: builtIn({ ...RULES, reasons: { ...RULES.reasons, voluntary: draw } }),
      },
    });
    await forfeit();
    expect(written(db, 'match_forfeits', 'insert')[0]).toMatchObject({
      winner_registration_id: null,
      winner_team_id: null,
      score_policy: 'draw',
    });
  });
});

describe('a team forfeit on a bracket bout', () => {
  it('asks for no reserve in the team’s place', async () => {
    // A round-1 bout not started, with an unused Registration a reserve swap would take.
    const { db, completion, forfeit } = teamBout({
      phaseType: 'single_elim',
      bout: { status: 'scheduled', bracket_slot_id: 'slot-1' },
      more: {
        bracket_slots: {
          rows: [
            {
              id: 'slot-1',
              phase_id: 'phase-1',
              round: 1,
              source_a_type: 'seed',
              source_b_type: 'seed',
              registration_a_id: null,
              registration_b_id: null,
            },
          ],
        },
        registrations: {
          rows: [{ id: 'reg-reserve', tournament_id: 'tournament-1', status: 'registered' }],
        },
      },
    });
    await forfeit();
    expect(writesTo(db, 'bracket_slots')).toEqual([]);
    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({ status: 'completed', winner_team_id: 'team-blue' }),
    ]);
    expect(completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });
});

describe('what a team forfeit refuses', () => {
  it('a team that is not a side of the bout', async () => {
    const { db, forfeit } = teamBout();
    await expect(forfeit({ forfeitingTeamId: 'team-green' })).rejects.toThrow(
      'The forfeiting team must be a side of the current match',
    );
    expect(db.writes).toEqual([]);
  });

  it('a team id sent as a Registration', async () => {
    const { db, service } = teamBout();
    await expect(
      service.createForfeit('m1', { forfeitingRegistrationId: 'team-red', reason: 'voluntary' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toEqual([]);
  });

  it('with no completion owner to hand the bout to, before anything is written', async () => {
    const { db, forfeit } = teamBout({ withoutCompletion: true });
    await expect(forfeit()).rejects.toThrow(/MatchCompletionService is not provided/);
    expect(db.writes).toEqual([]);
  });
});
