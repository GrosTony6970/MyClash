import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { filtersFor, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  BEFORE_THE_CARD,
  REFUSED,
  SCORER,
  blackCard,
  otherForfeit,
  setup,
  written,
  type Seed,
} from './penalties.void-black-card.fixtures';

/**
 * Ruling 319: taking a black card back takes back what the card did. The bout
 * returns to what it was, and a Fighter the card put out of the Tournament is
 * back in. It lands whole or not at all: where the forfeit cannot be taken
 * back, the card stays.
 *
 * The REAL `MatchForfeitsService` is under test with the service. The double
 * applies no write, so every claim here is a write and its filter.
 */
describe('PenaltiesService.voidPenalty: a black card that ended its bout', () => {
  it('takes the forfeit back, then the card', async () => {
    const { db, scoring, undo } = setup();

    await undo();

    // The review's delete is last: it is asked for once the card is voided.
    expect(written(db)).toEqual([
      'matches',
      'registrations',
      'match_forfeits',
      'match_penalties',
      'tournament_penalty_reviews',
    ]);
    const [bout] = writesTo(db, 'matches');
    expect(bout?.row).toMatchObject(BEFORE_THE_CARD);
    expect(scopedTo(bout, 'id')).toBe('m1');
    const [stamp] = writesTo(db, 'match_forfeits');
    expect(stamp?.row).toMatchObject({ voided_by_user_id: SCORER });
    expect(scopedTo(stamp, 'id')).toBe('forfeit-1');
    const [card] = writesTo(db, 'match_penalties');
    expect(card?.row).toMatchObject({ voided: true, voided_reason: 'wrong fighter' });
    expect(scopedTo(card, 'id')).toBe('card-black');
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('puts the Fighter back in: the status the forfeit found', async () => {
    const { db, undo } = setup();

    await undo();

    const [fighter] = writesTo(db, 'registrations');
    expect(fighter?.row).toEqual({ status: 'confirmed' });
    expect(scopedTo(fighter, 'id')).toBe('reg-blue');
  });

  it('a scorekeeper’s PIN session takes it back too, and signs the void', async () => {
    const { db, undo } = setup();

    await undo('card-black', { staffAccountId: 'staff-1' });

    expect(writesTo(db, 'match_forfeits')[0]?.row).toMatchObject({
      voided_by_user_id: null,
      voided_by_staff_account_id: 'staff-1',
    });
    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });

  it('asks whether the correction lands before the forfeit is touched (ruling 226)', async () => {
    const { db, scoring, undo } = setup();
    const refusal = new ConflictException({ code: 'correction_later_bout_fought' });
    scoring.assertCorrectionLands.mockRejectedValueOnce(refusal);

    await expect(undo()).rejects.toBe(refusal);
    expect(db.writes).toEqual([]);
  });

  it('reads the forfeit of THIS bout, THIS Fighter, made by a black card, still live', async () => {
    const { db, undo } = setup();

    await undo();

    expect(selectsFor(db.from, 'match_forfeits').slice(0, 2)).toEqual([
      'id, replacement_registration_id, created_at',
      'id, parent_forfeit_id, created_at',
    ]);
    // The first read of the table is the leaf's; the forfeit service's follow.
    expect(filtersFor(db.from, 'match_forfeits', 'eq').slice(0, 2)).toEqual([
      ['match_id', 'm1'],
      ['forfeiting_registration_id', 'reg-blue'],
    ]);
    expect(filtersFor(db.from, 'match_forfeits', 'in')[0]).toEqual([
      'reason',
      ['black_card_1', 'black_card_2'],
    ]);
    expect(filtersFor(db.from, 'match_forfeits', 'is')[0]).toEqual(['voided_at', null]);
    expect(selectsFor(db.from, 'tournament_penalty_reviews')[0]).toBe('id');
    expect(filtersFor(db.from, 'tournament_penalty_reviews', 'eq').slice(0, 3)).toEqual([
      ['tournament_id', 'tournament-1'],
      ['registration_id', 'reg-blue'],
      ['status', 'confirmed'],
    ]);
    // The card itself is never counted among "the others".
    expect(filtersFor(db.from, 'match_penalties', 'neq')[0]).toEqual(['id', 'card-black']);
  });
});

describe('PenaltiesService.voidPenalty: a black card that cannot be taken back whole', () => {
  it.each<[string, Seed]>([
    ['a reserve took the Fighter’s place', { forfeit: { replacement_registration_id: 'reg-9' } }],
    [
      'an organiser confirmed the second black card review',
      {
        reviews: [
          {
            id: 'review-1',
            tournament_id: 'tournament-1',
            registration_id: 'reg-blue',
            review_type: 'second_black_card',
            status: 'confirmed',
          },
        ],
      },
    ],
    [
      'a bout this one feeds was fought',
      {
        forfeit: { downstream_match_ids: ['m2'] },
        laterBout: { status: 'completed', started_at: '2026-10-06T10:30:00.000Z' },
      },
    ],
    ['the bout was fought again since', { bout: { end_reason: 'first_to_points' } }],
    // Its void would write back the status THIS forfeit found: back in, over the later one.
    ['a later forfeit put the Fighter out again', { otherForfeits: [otherForfeit()] }],
  ])('refuses when %s, and writes nothing', async (_why, seed) => {
    const { db, scoring, undo } = setup(seed);

    const refusal = await undo().catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject(REFUSED);
    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['made BEFORE this one', { created_at: '2026-10-06T09:00:00.000Z' }],
    ['of ANOTHER Fighter', { forfeiting_registration_id: 'reg-red' }],
    ['somebody voided', { voided_at: '2026-10-06T11:30:00.000Z' }],
    ['this one made itself (a Pool bout closed with it)', { parent_forfeit_id: 'forfeit-1' }],
  ])('another forfeit %s refuses nothing', async (_which, over) => {
    const { db, undo } = setup({ otherForfeits: [otherForfeit(over)] });

    await undo();

    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });

  it('a review of ANOTHER Fighter, or one still pending, refuses nothing', async () => {
    const review = { tournament_id: 'tournament-1', review_type: 'second_black_card' };
    const { db, undo } = setup({
      reviews: [
        { ...review, id: 'review-1', registration_id: 'reg-red', status: 'confirmed' },
        { ...review, id: 'review-2', registration_id: 'reg-blue', status: 'pending' },
      ],
    });

    await undo();

    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });

  it('on an over Event the Event’s refusal comes first', async () => {
    const { db, undo } = setup({ eventStatus: 'archived' });

    await expect(undo()).rejects.toEqual(
      new ConflictException({ message: 'Event results are frozen', code: 'event_results_frozen' }),
    );
    expect(db.writes).toEqual([]);
  });
});

describe('PenaltiesService.voidPenalty: a card whose void leaves the forfeit alone', () => {
  // The black card is voided: nothing but "this card is not black" keeps the forfeit.
  it('a yellow card on a forfeited bout', async () => {
    const { db, undo } = setup({
      cards: [blackCard({ voided: true }), blackCard({ id: 'card-yellow', card: 'yellow' })],
    });

    await undo('card-yellow');

    expect(written(db)).toEqual(['match_penalties']);
  });

  it('a black card beside another live black card of the same Fighter on the bout', async () => {
    const { db, undo } = setup({ cards: [blackCard(), blackCard({ id: 'card-black-2' })] });

    await undo('card-black-2');

    expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
  });

  it('a voided black card beside it does not count', async () => {
    const { db, undo } = setup({
      cards: [blackCard(), blackCard({ id: 'card-old', voided: true })],
    });

    await undo();

    expect(writesTo(db, 'match_forfeits')).toHaveLength(1);
  });

  it.each<[string, Seed['forfeit']]>([
    ['no forfeit', null],
    ['a forfeit somebody voided already', { voided_at: '2026-10-06T10:05:00.000Z' }],
  ])('a black card with %s on its bout', async (_what, forfeit) => {
    const { db, undo } = setup({ forfeit });

    await undo();

    expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
  });
});
