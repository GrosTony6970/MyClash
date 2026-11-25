import { describe, expect, it } from 'vitest';
import { selectsFor } from '../../common/testing/supabase-chain';
import {
  BOUT_SIDE_SELECT,
  kept,
  MATCH_SELECT,
  refuseFirstUpdate,
  SNAPSHOT_SELECT,
  stamped,
  teamBout,
  written,
} from './match-forfeits.team.fixtures';

/**
 * A team forfeit has no status settle to repair a send cut short (call 13): its resend runs the
 * one team repair (`repairTeamForfeit`), and its take-back hands the bout back to the completion
 * owner itself. The harness is `match-forfeits.team.fixtures.ts`.
 */

describe('a team forfeit sent again after a send cut short', () => {
  it('the insert stood and the completion failed: the resend completes the bout, stamps it, hands it on', async () => {
    const first = teamBout();
    refuseFirstUpdate(first.db, 'matches');
    await expect(first.forfeit()).rejects.toThrow(/was not completed by its forfeit/);
    expect(first.completion.onMatchCompleted).not.toHaveBeenCalled();

    // The resend meets the record on a bout still in play.
    const again = teamBout({ history: [kept(first.db)] });
    await again.forfeit();

    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([]);
    expect(written(again.db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'completed',
        winner_registration_id: null,
        winner_team_id: 'team-blue',
        red_score: 0,
        blue_score: 9,
        end_reason: 'forfeit',
      }),
    ]);
    expect(stamped(again.db, 'ff-m1')).toHaveLength(1);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
    expect(again.db.rpc).not.toHaveBeenCalled();
    expect(selectsFor(again.db.from, 'matches')).toEqual([
      MATCH_SELECT,
      BOUT_SIDE_SELECT,
      SNAPSHOT_SELECT,
    ]);
  });

  it('the stamp failed: the resend stamps the completed bout and hands it on', async () => {
    const first = teamBout();
    refuseFirstUpdate(first.db, 'match_forfeits');
    await expect(first.forfeit()).rejects.toThrow(/did not keep its result/);
    expect(first.completion.onMatchCompleted).not.toHaveBeenCalled();

    const completed = {
      status: 'completed',
      winner_team_id: 'team-blue',
      red_score: 0,
      blue_score: 9,
      end_reason: 'forfeit',
    };
    const again = teamBout({ bout: completed, history: [kept(first.db)] });
    await expect(again.forfeit()).rejects.toThrow('Match is already closed');

    expect(written(again.db, 'matches', 'update')).toEqual([]);
    expect(stamped(again.db, 'ff-m1')).toHaveLength(1);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('a completed bout whose record kept its result is only handed on again', async () => {
    const record = {
      id: 'ff-m1',
      match_id: 'm1',
      forfeiting_team_id: 'team-red',
      winner_team_id: 'team-blue',
      voided_at: null,
      resulting_match_state: { status: 'completed', winner_team_id: 'team-blue' },
    };
    const { db, completion, forfeit } = teamBout({
      bout: { status: 'completed', winner_team_id: 'team-blue' },
      history: [record],
    });
    await expect(forfeit()).rejects.toThrow('Match is already closed');
    expect(db.writes).toEqual([]);
    expect(completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });
});

describe('a team forfeit taken back', () => {
  /** The red team forfeited a Pool bout it was fighting: the blue team won 9-0. */
  const FORFEIT = {
    id: 'ff-m1',
    match_id: 'm1',
    tournament_id: 'tournament-1',
    forfeiting_registration_id: null,
    forfeiting_team_id: 'team-red',
    winner_registration_id: null,
    winner_team_id: 'team-blue',
    reason: 'voluntary',
    voided_at: null,
    downstream_match_ids: [],
    previous_match_state: {
      status: 'running',
      red_score: 2,
      blue_score: 3,
      winner_registration_id: null,
      winner_team_id: null,
      ended_at: null,
      end_reason: null,
    },
    resulting_match_state: {
      status: 'completed',
      red_score: 0,
      blue_score: 9,
      winner_registration_id: null,
      winner_team_id: 'team-blue',
      end_reason: 'forfeit',
    },
  };
  const FORFEITED = {
    status: 'completed',
    red_score: 0,
    blue_score: 9,
    winner_team_id: 'team-blue',
    end_reason: 'forfeit',
  };

  /** An organiser's correction of a Match the red team had won: the blue team wins it now. */
  const OVERRIDE = {
    ...FORFEIT,
    id: 'ff-override',
    reason: 'admin_correction',
    previous_match_state: {
      status: 'completed',
      red_score: 5,
      blue_score: 3,
      winner_registration_id: null,
      winner_team_id: 'team-red',
      ended_at: '2026-11-25T10:00:00.000Z',
      end_reason: 'time',
    },
    resulting_match_state: {
      ...FORFEIT.resulting_match_state,
      red_score: 1,
      blue_score: 5,
      end_reason: 'override',
    },
  };
  const OVERRIDDEN = { ...FORFEITED, red_score: 1, blue_score: 5, end_reason: 'override' };

  it('puts the Pool bout back in play with no winner team, and settles nobody', async () => {
    const { db, service, completion } = teamBout({ bout: FORFEITED, history: [FORFEIT] });
    await service.voidForfeit('ff-m1');

    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'running',
        red_score: 2,
        blue_score: 3,
        winner_registration_id: null,
        winner_team_id: null,
      }),
    ]);
    expect(completion.onBoutPutBack).toHaveBeenCalledWith('m1');
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('restores the winner team a correction replaced, and hands that result on again', async () => {
    const { db, service, completion } = teamBout({ bout: OVERRIDDEN, history: [OVERRIDE] });
    await service.voidForfeit('ff-override');

    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'completed',
        red_score: 5,
        blue_score: 3,
        winner_registration_id: null,
        winner_team_id: 'team-red',
        end_reason: 'time',
      }),
    ]);
    // The restored result is decided: it is advanced again, by its winner team.
    expect(completion.onMatchCompleted).toHaveBeenCalledWith('m1');
    expect(completion.onBoutPutBack).toHaveBeenCalledWith('m1');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('puts the bout back when the card door settles itself, and settles nobody', async () => {
    const { db, service, completion } = teamBout({ bout: FORFEITED, history: [FORFEIT] });
    await service.voidForfeit('ff-m1', {}, { settledByCaller: true });
    expect(completion.onBoutPutBack).toHaveBeenCalledWith('m1');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('a take-back sent again after its stamp puts the bout back, then is refused', async () => {
    const voided = { ...FORFEIT, voided_at: '2026-11-25T11:00:00.000Z' };
    const { db, service, completion } = teamBout({ bout: FORFEITED, history: [voided] });
    await expect(service.voidForfeit('ff-m1')).rejects.toThrow('Forfeit is already voided');
    expect(completion.onBoutPutBack).toHaveBeenCalledWith('m1');
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
