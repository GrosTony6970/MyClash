import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { queriedTables, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import {
  ANA_BOUTS,
  BEFORE_SPELL,
  DURING_SPELL,
  anasTournament,
  bout,
  boutsWritten,
  forfeit,
  inserted,
  rulesInForce,
} from './fighter-reconcile.fixtures';

/**
 * While a Fighter is out, their Pool bouts follow (slice B, B2): every scheduled or paused bout of
 * theirs in every Pool phase is forfeited, scored by why they are out (rulings 57, 69, 71, 78,
 * 110). Through the real `FighterStatusService.settle` on seeded tables.
 */

const what = (rows: SupabaseRow[]) =>
  rows.map((row) => [row['match_id'], row['reason'], row['parent_forfeit_id']]);

describe('a Fighter out: their Pool bouts are forfeited', () => {
  it('a hand withdrawal forfeits each scheduled or paused Pool bout of hers as voluntary (110)', async () => {
    const { db, settle } = anasTournament({ statuses: ['withdrawn'] });
    const result = await settle();

    // Not the running bout, the finished one, the bracket bout, nor a bout that is not hers.
    expect(what(inserted(db))).toEqual([
      ['m-scheduled', 'voluntary', null],
      ['m-paused', 'voluntary', null],
    ]);
    expect(inserted(db)[1]).toMatchObject({
      forfeiting_registration_id: 'reg-ana',
      winner_registration_id: 'reg-cy',
      auto_created: true,
      can_continue: false,
      by_user_id: 'user-org',
      previous_match_state: { status: 'paused', red_score: 2, blue_score: 1 },
    });
    expect(boutsWritten(db)).toEqual(['m-scheduled', 'm-paused']);
    // She is blue on the paused bout: Cy wins it 6-0.
    expect(writesTo(db, 'matches')[1]!.row).toMatchObject({
      status: 'completed',
      red_score: 6,
      blue_score: 0,
      winner_registration_id: 'reg-cy',
      end_reason: 'forfeit',
    });
    expect(result).toMatchObject({ after: 'withdrawn', forfeited: 2, broughtBack: 0 });
  });

  it('leaves a bout the organiser put back in this spell; forfeits one put back before it, or by a return', async () => {
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: [...ANA_BOUTS, bout('m-earlier', 'pool-2', 'scheduled')],
      forfeits: [
        // Her bout put back by hand while she is out (ruling 105's step 2): it stays back.
        forfeit('f-hand', { match_id: 'm-scheduled', auto_created: true, voided_at: DURING_SPELL }),
        // Put back by the reconcile when she came back in: forfeited again now she is out.
        forfeit('f-return', {
          match_id: 'm-paused',
          auto_created: true,
          voided_at: DURING_SPELL,
          voided_by_return: true,
        }),
        // Put back by hand in an EARLIER spell: forfeited again.
        forfeit('f-old', { match_id: 'm-earlier', auto_created: true, voided_at: BEFORE_SPELL }),
      ],
    });
    await settle();
    expect(inserted(db).map((row) => row['match_id'])).toEqual(['m-paused', 'm-earlier']);
  });

  it('a bout a card’s take-back reopened is forfeited again while she stays withdrawn (116)', async () => {
    // Ruling 107's story: a card ended bout 2, she withdrew injured in bout 4, then the card was
    // taken back. Its forfeit was a person's record, voided by hand: not a put-back of hers.
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: [bout('m-paused', 'pool-1', 'paused', { red_score: 2, blue_score: 1 })],
      forfeits: [
        forfeit('f-injury', { match_id: 'm-4', fighter_outcome: 'withdrawn' }),
        forfeit('f-card', {
          match_id: 'm-paused',
          reason: 'black_card_1',
          voided_at: DURING_SPELL,
        }),
      ],
    });
    await settle();
    expect(what(inserted(db))).toEqual([['m-paused', 'injury', 'f-injury']]);
  });

  it('a forfeit that withdrew her scores the bouts as its reason, and they hang off it', async () => {
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      forfeits: [forfeit('f-injury', { match_id: 'm-done', fighter_outcome: 'withdrawn' })],
    });
    await settle();
    expect(what(inserted(db))).toEqual([
      ['m-scheduled', 'injury', 'f-injury'],
      ['m-paused', 'injury', 'f-injury'],
    ]);
    // An injury keeps the score of the bout as it stood.
    expect(writesTo(db, 'matches')[1]!.row).toMatchObject({ red_score: 2, blue_score: 1 });
  });

  it('a conduct forfeit recorded under a withdrawal disqualifies: its bouts hang off the root (112)', async () => {
    const { db, settle } = anasTournament({
      statuses: ['disqualified'],
      forfeits: [
        forfeit('f-conduct', {
          match_id: 'm-done',
          reason: 'conduct_violation',
          fighter_outcome: 'disqualified',
          parent_forfeit_id: 'f-root',
        }),
        forfeit('f-root-of-other', { match_id: 'm-x', fighter_outcome: 'withdrawn' }),
      ],
    });
    await settle();
    expect(what(inserted(db))[0]).toEqual(['m-scheduled', 'conduct_violation', 'f-root']);
  });

  it('a black card that reaches the Tournament: a 0-X black card loss, on no record (57, 69)', async () => {
    const { db, settle } = anasTournament({
      statuses: ['disqualified'],
      cards: [
        { id: 'c1', tournament_id: 't1', registration_id: 'reg-ana', card: 'black', voided: false },
      ],
    });
    await settle({
      rules: rulesInForce({ firstBlackCard: 'tournament', blackCardOpponentScore: 9 }),
    });
    expect(what(inserted(db))[0]).toEqual(['m-scheduled', 'black_card_1', null]);
    expect(writesTo(db, 'matches')[0]!.row).toMatchObject({
      red_score: 0,
      blue_score: 9,
      end_reason: 'black_card',
    });
  });

  it('a confirmed review standing on two live cards: a 2nd black card loss (78)', async () => {
    const card = (id: string) => ({
      id,
      tournament_id: 't1',
      registration_id: 'reg-ana',
      card: 'black',
      voided: false,
    });
    const { db, settle } = anasTournament({
      statuses: ['disqualified'],
      cards: [card('c1'), card('c2')],
      reviews: [
        {
          tournament_id: 't1',
          registration_id: 'reg-ana',
          review_type: 'second_black_card',
          status: 'confirmed',
          payload_json: { answeredPenaltyIds: ['c1', 'c2'] },
        },
      ],
    });
    // A review opens only when the 2nd card's own rule ends the bout alone (ruling 86): the
    // review, not the cards, holds her out.
    await settle({ rules: rulesInForce({ secondBlackCard: 'match' }) });
    expect(what(inserted(db))[0]).toEqual(['m-scheduled', 'black_card_2', null]);
  });

  it('"disqualify after 2": the bouts hang off the forfeit that reached 2', async () => {
    const { db, settle } = anasTournament({
      statuses: ['disqualified'],
      forfeits: [
        forfeit('f-1', {
          match_id: 'm-a',
          reason: 'voluntary',
          created_at: '2026-10-21T08:00:00Z',
        }),
        forfeit('f-2', { match_id: 'm-b', reason: 'injury', created_at: '2026-10-21T09:00:00Z' }),
        forfeit('f-3', {
          match_id: 'm-c',
          reason: 'voluntary',
          created_at: '2026-10-21T09:30:00Z',
        }),
      ],
    });
    await settle({ rules: rulesInForce({ disqualifyAfter: 2 }) });
    expect(what(inserted(db))[0]).toEqual(['m-scheduled', 'injury', 'f-2']);
  });

  it('a forfeit under the out status is not one of the N (rulings 118, 120)', async () => {
    const at = (time: string) => `2026-10-21T0${time}:00:00Z`;
    const { db, settle } = anasTournament({
      statuses: ['disqualified'],
      forfeits: [
        forfeit('f-1', { match_id: 'm-a', reason: 'voluntary', created_at: at('7') }),
        forfeit('f-hand', { match_id: 'm-b', under_out_status: true, created_at: at('8') }),
        forfeit('f-2', { match_id: 'm-c', reason: 'voluntary', created_at: at('9') }),
      ],
    });
    await settle({ rules: rulesInForce({ disqualifyAfter: 2 }) });
    expect(what(inserted(db))[0]).toEqual(['m-scheduled', 'voluntary', 'f-2']);
  });

  it('a withdrawal whose reason draws makes the bouts 0-0 draws with no winner (71)', async () => {
    const rules = rulesInForce();
    const draw = { ...rules.reasons.injury, outcome: 'draw' as const };
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      forfeits: [forfeit('f-injury', { match_id: 'm-done', fighter_outcome: 'withdrawn' })],
    });
    await settle({ rules: { ...rules, reasons: { ...rules.reasons, injury: draw } } });
    expect(inserted(db)[0]).toMatchObject({ score_policy: 'draw', winner_registration_id: null });
    expect(writesTo(db, 'matches')[0]!.row).toMatchObject({ red_score: 0, blue_score: 0 });
  });
});

describe('a take-out cut short, and the bout writes the database refuses', () => {
  const only = [bout('m-scheduled', 'pool-1', 'scheduled')];
  const held = (by: string) => ({
    id: 'f-held',
    forfeiting_registration_id: by,
    auto_created: true,
    reason: 'voluntary',
    winner_registration_id: 'reg-bob',
    forfeiting_score: 0,
    opponent_score: 6,
  });
  const queue = (heldBy: string) => [
    { data: [], error: null }, // the bouts put back by hand
    { data: [], error: null }, // her live forfeits, for the cause
    { data: null, error: { code: '23505', message: 'one active per match' } },
    { data: [held(heldBy)], error: null },
    { data: null, error: null },
  ];

  it('a bout already holding her record, not yet completed, is completed by it', async () => {
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: only,
      forfeitsTable: queue('reg-ana'),
    });
    const result = await settle();
    expect(boutsWritten(db)).toEqual(['m-scheduled']);
    expect(writesTo(db, 'matches')[0]!.row).toMatchObject({
      status: 'completed',
      red_score: 0,
      blue_score: 6,
      winner_registration_id: 'reg-bob',
    });
    expect(result.forfeited).toBe(1);
  });

  it('a bout holding somebody else’s record is left alone', async () => {
    const { db, settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: only,
      forfeitsTable: queue('reg-bob'),
    });
    const result = await settle();
    expect(boutsWritten(db)).toEqual([]);
    expect(result.forfeited).toBe(0);
  });

  it('any other refusal is a server error, never a 400 the pad would file as refused', async () => {
    const { settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: only,
      forfeitsTable: [
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: { code: '23514', message: 'a check' } },
      ],
    });
    const error = await settle().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toMatch(/m-scheduled was not forfeited/);
  });

  it('a bout the database refuses to complete is a server error: the retry finds it held', async () => {
    const { settle } = anasTournament({
      statuses: ['withdrawn'],
      matchesTable: [
        { data: only, error: null },
        { data: null, error: { message: 'a lock' } },
      ],
    });
    const error = await settle().catch((err: unknown) => err);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toMatch(/m-scheduled was not completed by its forfeit/);
  });

  it('a result the record does not keep is a server error: a void would compare nothing', async () => {
    const { settle } = anasTournament({
      statuses: ['withdrawn'],
      bouts: only,
      forfeitsTable: [
        { data: [], error: null },
        { data: [], error: null },
        { data: { id: 'new-1' }, error: null },
        { data: null, error: { message: 'a lock' } },
      ],
    });
    const error = await settle().catch((err: unknown) => err);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toMatch(/new-1 did not keep its result/);
  });
});

describe('around the take-out', () => {
  it('on an Event that is over, the status settles and no bout is read or written', async () => {
    const { db, calls, settle } = anasTournament({ statuses: ['withdrawn'], eventOpen: false });
    const result = await settle();
    expect(calls).toHaveLength(1);
    expect(queriedTables(db.from)).not.toContain('matches');
    expect(db.writes).toEqual([]);
    expect(result).toMatchObject({ forfeited: 0, broughtBack: 0 });
  });

  it('hands each Pool phase to the completion owner once, the door’s own bout first (109)', async () => {
    const { deps, settle } = anasTournament({ statuses: ['withdrawn'] });
    await settle({ completedPoolBout: { matchId: 'm-door', phaseId: 'pool-1' } });
    const asked = deps.matchCompletion.onMatchCompleted.mock.calls.map(([id]) => id);
    // pool-1 by the door's bout, pool-2 by the paused bout the take-out completed.
    expect(asked).toEqual(['m-door', 'm-paused']);
  });

  it('with no door bout, once per phase the take-out completed bouts in', async () => {
    const { deps, settle } = anasTournament({ statuses: ['withdrawn'] });
    await settle();
    const asked = deps.matchCompletion.onMatchCompleted.mock.calls.map(([id]) => id);
    expect(asked).toEqual(['m-scheduled', 'm-paused']);
  });
});
