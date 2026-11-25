import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import {
  BLACK_CARD,
  LEAVING,
  leftThePiste,
  teamCardBout,
  written,
} from './penalties.team-card.fixtures';

/**
 * A card on a team names the team (ADR-022, call 5). A team black card loses this Match only
 * (ruling 972): no Tournament count, no "second black card" review, no status settle, whatever the
 * penalty list says a black card reaches. A team's card count starts fresh every Match (ruling
 * 976). The harness is `penalties.team-card.fixtures.ts`; the resends and the take-back are
 * `penalties.team-card-retry.test.ts`.
 */

describe('a card on a team bout names the team', () => {
  it('a yellow is written on the team, and priced by the list, with no forfeit', async () => {
    const { db, send } = teamCardBout();

    await send({ directCard: 'yellow', reason: 'late on guard' });

    expect(written(db, 'match_penalties', 'insert')).toEqual([
      expect.objectContaining({
        match_id: 'm1',
        registration_id: null,
        team_id: 'team-red',
        card: 'yellow',
        score_delta: -1,
      }),
    ]);
    expect(written(db, 'match_forfeits', 'insert')).toEqual([]);
  });

  it('a team that is no side of the bout is refused, and nothing is written', async () => {
    const { db, send } = teamCardBout();

    const sent = send({ teamId: 'team-green', directCard: 'yellow', reason: 'x' });

    await expect(sent).rejects.toThrow('The penalised team must be a side of the current match');
    expect(written(db, 'match_penalties', 'insert')).toEqual([]);
  });

  it('a Registration on a team bout is refused: it is no side of it', async () => {
    const { db, send } = teamCardBout();

    const sent = send({
      teamId: undefined,
      registrationId: 'reg-anna',
      directCard: 'yellow',
      reason: 'x',
    });

    await expect(sent).rejects.toThrow('Penalty registration must belong to the current match');
    expect(written(db, 'match_penalties', 'insert')).toEqual([]);
  });

  it('a team id sent as a Registration is refused by its kind', async () => {
    const { db, send } = teamCardBout();

    const sent = send({
      teamId: undefined,
      registrationId: 'team-red',
      directCard: 'yellow',
      reason: 'x',
    });

    await expect(sent).rejects.toBeInstanceOf(BadRequestException);
    await expect(sent).rejects.toThrow('Penalty registration must belong to the current match');
    expect(written(db, 'match_penalties', 'insert')).toEqual([]);
  });
});

describe('a team black card loses this Match only (ruling 972)', () => {
  it('ends the Match as a loss of the team, 0 to the list’s score, though the list reaches nothing', async () => {
    const { db, completion, send } = teamCardBout();

    await send(BLACK_CARD);

    expect(written(db, 'match_penalties', 'insert')).toEqual([
      expect.objectContaining({ registration_id: null, team_id: 'team-red', card: 'black' }),
    ]);
    expect(written(db, 'match_forfeits', 'insert')).toEqual([
      expect.objectContaining({
        forfeiting_registration_id: null,
        forfeiting_team_id: 'team-red',
        winner_team_id: 'team-blue',
        reason: 'black_card_1',
        forfeiting_score: 0,
        opponent_score: 7,
        can_continue: true,
        fighter_outcome: null,
        note: 'brutality',
      }),
    ]);
    expect(written(db, 'matches', 'update')).toEqual([
      expect.objectContaining({
        status: 'completed',
        winner_registration_id: null,
        winner_team_id: 'team-blue',
        red_score: 0,
        blue_score: 7,
        end_reason: 'black_card',
      }),
    ]);
    expect(completion.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('counts nothing over the Tournament, opens no review and settles nobody', async () => {
    const { db, status, send } = teamCardBout();

    await send(BLACK_CARD);

    // The card's own replay probe and its insert: no count of the team's black cards.
    expect(selectsFor(db.from, 'match_penalties')).toEqual(['*', '*']);
    expect(queriedTables(db.from)).not.toContain('tournament_penalty_reviews');
    expect(status.settle).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('scores with the list’s own rules, never the Tournament’s stored changes (call 1)', async () => {
    const { db, send } = teamCardBout({ changes: { blackCardOpponentScore: 3 } });

    await send(BLACK_CARD);

    expect(written(db, 'match_forfeits', 'insert')[0]).toMatchObject({ opponent_score: 7 });
  });

  it('on a bout already completed forfeits nothing: the card stays on record (call 2)', async () => {
    const { db, completion, send } = teamCardBout({
      bout: { status: 'completed', winner_team_id: 'team-red', red_score: 5, blue_score: 3 },
    });

    await send(BLACK_CARD);

    expect(written(db, 'match_penalties', 'insert')).toEqual([
      expect.objectContaining({ team_id: 'team-red', card: 'black' }),
    ]);
    expect(written(db, 'match_forfeits', 'insert')).toEqual([]);
    expect(written(db, 'matches', 'update')).toEqual([]);
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('forfeit rules that do not parse are a server error, before the card is written', async () => {
    // The tablet sends a card again on a server error: no card may stand with no forfeit.
    const { db, send } = teamCardBout({ forfeitRules: { disqualifyAfter: 0 } });

    await expect(send(BLACK_CARD)).rejects.toThrow('The forfeit rules of penalty ruleset');
    expect(written(db, 'match_penalties', 'insert')).toEqual([]);
  });
});

describe('a team’s card count starts fresh every Match (ruling 976)', () => {
  it('a repeat offence in a 2nd Match prices as a first, though the list counts over the Tournament', async () => {
    const { db, send } = teamCardBout({ cards: [leftThePiste('m7')] });

    await send({ rulesetEntryId: LEAVING.id });

    expect(written(db, 'match_penalties', 'insert')[0]).toMatchObject({
      team_id: 'team-red',
      card: 'yellow',
    });
    expect(filtersFor(db.from, 'match_penalties', 'eq')).toEqual(
      expect.arrayContaining([
        ['team_id', 'team-red'],
        ['match_id', 'm1'],
      ]),
    );
  });

  it('a repeat offence in the same Match prices as a repeat', async () => {
    const { db, send } = teamCardBout({ cards: [leftThePiste('m1')] });

    await send({ rulesetEntryId: LEAVING.id });

    expect(written(db, 'match_penalties', 'insert')[0]).toMatchObject({
      team_id: 'team-red',
      card: 'red',
      score_delta: -2,
    });
  });

  it('the pad reads the priors keyed by team id, from this Match only, and is told so', async () => {
    const { service } = teamCardBout({ cards: [leftThePiste('m7'), leftThePiste('m1')] });

    // The list counts over the Tournament; a team bout's answer says where its priors come from.
    await expect(service.getPenaltyScopeForMatch('m1')).resolves.toEqual({
      accumulationScope: 'match',
      priors: {
        'team-red': [
          { sideId: 'team-red', groupNumber: 4, card: 'yellow', source: 'ruleset', voided: false },
        ],
        'team-blue': [],
      },
    });
  });
});
