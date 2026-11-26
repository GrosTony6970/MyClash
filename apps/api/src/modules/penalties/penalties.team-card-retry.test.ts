import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  queriedTables,
  selectsFor,
  supabaseChain,
  writesTo,
} from '../../common/testing/supabase-chain';
import { refuseFirstUpdate } from '../matches/match-forfeits.team.fixtures';
import {
  BLACK_CARD,
  CARD_SAVED_AT,
  ENDED_BY_THE_CARD,
  TEAM_BOUT,
  keptCard,
  keptForfeit,
  teamCardBout,
  written,
} from './penalties.team-card.fixtures';

/**
 * A team black card sent again, and taken back (ruling 972). The tablet sends a card again on a
 * server error, and its resend is the only send left to finish the team's forfeit of the Match:
 * it goes through the forfeit door's one team repair (`repairTeamForfeit`). A team has no status:
 * neither the resend nor the take-back opens a review or settles anybody.
 */

const RECORD_SELECT =
  'id, match_id, reason, forfeiting_registration_id, forfeiting_team_id, winner_registration_id, winner_team_id, forfeiting_score, opponent_score, resulting_match_state';

/** The read of a team black-card forfeit taken back since the card was saved. */
const TAKEN_BACK_SELECT = 'id';

/** The forfeit's write that kept its result (`stampResultingState`). */
const stamps = (db: ReturnType<typeof teamCardBout>['db']) =>
  written(db, 'match_forfeits', 'update').filter((row) => 'resulting_match_state' in row);

describe('a team black card sent again after a send cut short', () => {
  it('the forfeit failed after the card: the resend ends the Match', async () => {
    const first = teamCardBout();
    refuseFirstUpdate(first.db, 'matches');
    await expect(first.send(BLACK_CARD)).rejects.toThrow(/was not completed by its forfeit/);
    expect(written(first.db, 'match_penalties', 'insert')).toHaveLength(1);

    const again = teamCardBout({ cards: [keptCard(first.db)], forfeits: [keptForfeit(first.db)] });
    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    expect(written(again.db, 'match_penalties', 'insert')).toEqual([]);
    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([]);
    expect(written(again.db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'completed',
        winner_team_id: 'team-blue',
        red_score: 0,
        blue_score: 7,
        end_reason: 'black_card',
      }),
    ]);
    expect(stamps(again.db)).toHaveLength(1);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
    expect(selectsFor(again.db.from, 'match_forfeits')).toEqual([RECORD_SELECT]);
    expect(again.status.settle).not.toHaveBeenCalled();
    expect(queriedTables(again.db.from)).not.toContain('tournament_penalty_reviews');
  });

  it('the forfeit never ran: the resend forfeits the Match', async () => {
    // The card stood and the server failed before its forfeit (a lost connection, say).
    const again = teamCardBout({ cards: [cardOf()] });

    await again.send(BLACK_CARD);

    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({
        forfeiting_team_id: 'team-red',
        reason: 'black_card_1',
        opponent_score: 7,
      }),
    ]);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
    // The live record, then the take-backs since the card, then the forfeit's own reads.
    expect(selectsFor(again.db.from, 'match_forfeits').slice(0, 2)).toEqual([
      RECORD_SELECT,
      TAKEN_BACK_SELECT,
    ]);
    expect(filtersFor(again.db.from, 'match_forfeits', 'gte')).toEqual([
      ['created_at', CARD_SAVED_AT],
    ]);
  });

  it('the result was not kept: the resend stamps the completed bout and hands it on', async () => {
    const first = teamCardBout();
    refuseFirstUpdate(first.db, 'match_forfeits');
    await expect(first.send(BLACK_CARD)).rejects.toThrow(/did not keep its result/);
    expect(first.completion.onMatchCompleted).not.toHaveBeenCalled();

    const again = teamCardBout({
      bout: ENDED_BY_THE_CARD,
      cards: [keptCard(first.db)],
      forfeits: [keptForfeit(first.db)],
    });
    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    expect(written(again.db, 'matches', 'update')).toEqual([]);
    expect(stamps(again.db)).toHaveLength(1);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
    expect(again.status.settle).not.toHaveBeenCalled();
  });

  it('a card given on a bout already completed is answered, and forfeits nothing', async () => {
    const again = teamCardBout({ bout: ENDED_BY_THE_CARD, cards: [cardOf()] });

    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([]);
    expect(again.completion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('a read of its forfeit that fails is an error, never "no forfeit": nothing is forfeited again', async () => {
    const again = teamCardBout({ cards: [cardOf()] });
    const seeded = again.db.from.getMockImplementation()!;
    again.db.from.mockImplementation((name: string) =>
      name === 'match_forfeits'
        ? supabaseChain({ data: null, error: { message: 'connection lost' } })
        : seeded(name),
    );

    await expect(again.send(BLACK_CARD)).rejects.toThrow(
      'The forfeit of the team black card was not read: connection lost',
    );
    expect(writesTo(again.db, 'match_forfeits')).toEqual([]);
    expect(again.completion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('a saved black card that names no side is an error, and nothing runs for it', async () => {
    const again = teamCardBout({ cards: [{ ...cardOf(), team_id: null }] });

    await expect(again.send(BLACK_CARD)).rejects.toThrow('Card card-new names no side');
    expect(writesTo(again.db, 'match_forfeits')).toEqual([]);
    expect(again.status.settle).not.toHaveBeenCalled();
    expect(queriedTables(again.db.from)).not.toContain('tournament_penalty_reviews');
  });
});

describe('a team black card sent again after its forfeit was taken back', () => {
  /** The card's forfeit, written after the card was saved, then voided by an organiser. */
  const TAKEN_BACK = { ...RECORD, voided_at: '2026-11-25T10:05:00.000Z' };
  /** An earlier card's forfeit, taken back before this card was saved. */
  const EARLIER = { ...TAKEN_BACK, id: 'ff-earlier', created_at: '2026-11-25T09:00:00.000Z' };

  it('its forfeit ran and was taken back: the resend leaves the bout in play', async () => {
    // The organiser put the bout back; the tablet never heard the first answer and sends again.
    const again = teamCardBout({ cards: [cardOf()], forfeits: [TAKEN_BACK] });

    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    expect(writesTo(again.db, 'match_forfeits')).toEqual([]);
    expect(written(again.db, 'matches', 'update')).toEqual([]);
    expect(again.completion.onMatchCompleted).not.toHaveBeenCalled();
    expect(selectsFor(again.db.from, 'match_forfeits')).toEqual([RECORD_SELECT, TAKEN_BACK_SELECT]);
  });

  it('a later black card, after an earlier forfeit was taken back, forfeits on its first send', async () => {
    const first = teamCardBout({ forfeits: [EARLIER] });

    await first.send(BLACK_CARD);

    expect(written(first.db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({ forfeiting_team_id: 'team-red', reason: 'black_card_1' }),
    ]);
    expect(first.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('and on its resend, when that first send stopped before its forfeit', async () => {
    const again = teamCardBout({ cards: [cardOf()], forfeits: [EARLIER] });

    await again.send(BLACK_CARD);

    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({ forfeiting_team_id: 'team-red', reason: 'black_card_1' }),
    ]);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('a read of the take-backs that fails is an error: nothing is forfeited', async () => {
    const again = teamCardBout({ cards: [cardOf()] });
    const seeded = again.db.from.getMockImplementation()!;
    let reads = 0;
    again.db.from.mockImplementation((name: string) =>
      name === 'match_forfeits' && ++reads === 2
        ? supabaseChain({ data: null, error: { message: 'connection lost' } })
        : seeded(name),
    );

    await expect(again.send(BLACK_CARD)).rejects.toThrow(
      'The taken-back forfeits of the team were not read: connection lost',
    );
    expect(writesTo(again.db, 'match_forfeits')).toEqual([]);
    expect(again.completion.onMatchCompleted).not.toHaveBeenCalled();
  });
});

/**
 * A resend reads two things of the bout's forfeits: the live one its card made, to repair it, and
 * one its card made since and an organiser took back. Each read keeps to this bout, this team and
 * a black card's reasons; a forfeit outside any of the three is not this card's.
 */
describe('a team black card sent again keeps to its bout, its team and a black card', () => {
  /** When an organiser took a forfeit back, after the card was saved. */
  const VOIDED_AT = '2026-11-25T10:05:00.000Z';
  /** The bout as the blue team's black card left it: the blue team lost it, 7 to 0. */
  const ENDED_BY_BLUE = { ...ENDED_BY_THE_CARD, winner_team_id: 'team-red' };
  /** The blue team's black-card forfeit, written after the red card was saved. */
  const BLUE = {
    ...RECORD,
    id: 'ff-blue',
    forfeiting_team_id: 'team-blue',
    winner_team_id: 'team-red',
    resulting_match_state: {},
  };
  /** The red team's withdrawal from the bout, written after the card was saved. */
  const WITHDRAWAL = {
    ...RECORD,
    id: 'ff-withdrawal',
    reason: 'voluntary',
    resulting_match_state: {},
  };

  /** The resend forfeited this bout for the red team's black card. */
  const forfeitedThisBout = (again: ReturnType<typeof teamCardBout>) => {
    expect(written(again.db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({
        match_id: 'm1',
        forfeiting_team_id: 'team-red',
        reason: 'black_card_1',
      }),
    ]);
    expect(again.completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  };

  /** The resend touched no forfeit and handed nothing on. */
  const leftAlone = (again: ReturnType<typeof teamCardBout>) => {
    expect(writesTo(again.db, 'match_forfeits')).toEqual([]);
    expect(written(again.db, 'matches', 'update')).toEqual([]);
    expect(again.completion.onMatchCompleted).not.toHaveBeenCalled();
  };

  it('a forfeit of the team on another bout is not its own: the resend forfeits this bout', async () => {
    // The red team's live black-card forfeit of bout m2, written after this card was saved.
    const again = teamCardBout({
      cards: [cardOf()],
      forfeits: [{ ...RECORD, id: 'ff-m2', match_id: 'm2' }],
    });

    await again.send(BLACK_CARD);

    forfeitedThisBout(again);
  });

  it('the other team’s live forfeit, which ended the bout, is not its own to repair', async () => {
    const again = teamCardBout({ bout: ENDED_BY_BLUE, cards: [cardOf()], forfeits: [BLUE] });

    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    leftAlone(again);
  });

  it('the other team’s forfeit taken back is not its own take-back: the resend forfeits', async () => {
    const again = teamCardBout({
      cards: [cardOf()],
      forfeits: [{ ...BLUE, voided_at: VOIDED_AT }],
    });

    await again.send(BLACK_CARD);

    forfeitedThisBout(again);
  });

  it('the team’s live forfeit for another reason is not its own to repair', async () => {
    const ENDED_BY_WITHDRAWAL = { ...ENDED_BY_THE_CARD, end_reason: 'forfeit' };
    const again = teamCardBout({
      bout: ENDED_BY_WITHDRAWAL,
      cards: [cardOf()],
      forfeits: [WITHDRAWAL],
    });

    await expect(again.send(BLACK_CARD)).resolves.toMatchObject({ id: 'card-new' });

    leftAlone(again);
  });

  it('the team’s forfeit for another reason, taken back, does not stop the resend', async () => {
    const again = teamCardBout({
      cards: [cardOf()],
      forfeits: [{ ...WITHDRAWAL, voided_at: VOIDED_AT }],
    });

    await again.send(BLACK_CARD);

    forfeitedThisBout(again);
  });
});

describe('a team black card taken back', () => {
  it('a 2nd black card of the team taken back leaves the forfeit its 1st made', async () => {
    const second = { ...cardOf(), id: 'card-2', client_uuid: 'uuid-2' };
    const { db, service, completion } = teamCardBout({
      bout: ENDED_BY_THE_CARD,
      cards: [cardOf(), second],
      forfeits: [RECORD],
    });

    await service.voidPenalty('card-2', { reason: 'given twice' }, { staffAccountId: 'staff-1' });

    expect(written(db, 'match_forfeits', 'update')).toEqual([]);
    expect(written(db, 'matches', 'update')).toEqual([]);
    expect(completion.onBoutPutBack).not.toHaveBeenCalled();
    expect(written(db, 'match_penalties', 'update')).toEqual([
      expect.objectContaining({ voided: true }),
    ]);
  });

  it('puts the bout back through its forfeit’s void, with no review and no settle', async () => {
    const { db, service, completion, status } = teamCardBout({
      bout: ENDED_BY_THE_CARD,
      cards: [cardOf()],
      forfeits: [RECORD],
    });

    await service.voidPenalty('card-new', { reason: 'wrong team' }, { staffAccountId: 'staff-1' });

    expect(written(db, 'match_forfeits', 'update')).toEqual([
      expect.objectContaining({ voided_at: expect.any(String) }),
    ]);
    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'running',
        red_score: 2,
        blue_score: 3,
        winner_team_id: null,
      }),
    ]);
    expect(completion.onBoutPutBack).toHaveBeenCalledWith('m1');
    expect(written(db, 'match_penalties', 'update')).toEqual([
      expect.objectContaining({ voided: true }),
    ]);
    expect(status.settle).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).not.toContain('tournament_penalty_reviews');
  });
});

/** The live forfeit the team black card made on the bout. */
const RECORD = {
  id: 'ff-m1',
  match_id: 'm1',
  tournament_id: 'tournament-1',
  forfeiting_registration_id: null,
  forfeiting_team_id: 'team-red',
  winner_registration_id: null,
  winner_team_id: 'team-blue',
  replacement_registration_id: null,
  reason: 'black_card_1',
  parent_forfeit_id: null,
  voided_at: null,
  downstream_match_ids: [],
  previous_match_state: {
    status: TEAM_BOUT.status,
    red_score: TEAM_BOUT.red_score,
    blue_score: TEAM_BOUT.blue_score,
    winner_registration_id: null,
    winner_team_id: null,
    ended_at: null,
    end_reason: null,
  },
  resulting_match_state: { ...ENDED_BY_THE_CARD, winner_registration_id: null },
  created_at: '2026-11-25T10:00:00.000Z',
};

/** The team black card as the server holds it. */
function cardOf() {
  return {
    id: 'card-new',
    client_uuid: 'card-uuid',
    match_id: 'm1',
    tournament_id: 'tournament-1',
    registration_id: null,
    team_id: 'team-red',
    source: 'direct',
    card: 'black',
    reason: 'brutality',
    voided: false,
    recorded_at: CARD_SAVED_AT,
  };
}
