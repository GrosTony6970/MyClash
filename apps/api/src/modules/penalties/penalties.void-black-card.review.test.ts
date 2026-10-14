import { describe, expect, it, vi } from 'vitest';
import { scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { PenaltiesController } from './penalties.controller';
import { blackCard, setup } from './penalties.void-black-card.fixtures';

/** Ruling 319, the rest: the route the pad calls, and the review a second black card asked for. */
describe('PATCH match-penalties/:id/void: the route the pad’s undo calls', () => {
  // Who may score is the route's own bar, held by its door tests. This holds
  // the hand-over: the caller that bar answered is the one who voids the forfeit.
  it('hands the caller "who may score" answered to the forfeit’s void', async () => {
    const { db, service } = setup();
    const staff = {
      authorizePenaltyScoring: vi.fn().mockResolvedValue({ staffAccountId: 'pad-7' }),
    };
    const controller = new PenaltiesController(service, db as never, staff as never, {} as never);
    const req = { headers: {} };

    await controller.voidPenalty('card-black', { reason: 'wrong fighter' }, req as never);

    expect(staff.authorizePenaltyScoring).toHaveBeenCalledWith(req, 'card-black');
    expect(writesTo(db, 'match_forfeits')[0]?.row).toMatchObject({
      voided_by_staff_account_id: 'pad-7',
    });
  });
});

describe('PenaltiesService.voidPenalty: the second black card review', () => {
  const VERSION = '2026-10-14T10:00:00.123456+00:00';
  const reviewOf = (status: string, payload: Record<string, unknown>) => ({
    id: 'review-1',
    tournament_id: 'tournament-1',
    registration_id: 'reg-blue',
    review_type: 'second_black_card',
    status,
    black_card_count: (payload['penaltyIds'] as unknown[]).length,
    payload_json: payload,
    updated_at: VERSION,
  });
  const pending = reviewOf('pending', { penaltyIds: ['card-x', 'card-black'] });
  const elsewhere = { match_id: 'm7' };
  const answer = (db: Parameters<typeof writesTo>[0]) => writesTo(db, 'tournament_penalty_reviews');

  it('is removed when fewer than two black cards remain and nobody answered it', async () => {
    const { db, undo } = setup({ reviews: [pending] });

    await undo();

    const [removed] = answer(db);
    expect(removed?.op).toBe('delete');
    expect(scopedTo(removed, 'id')).toBe('review-1');
    expect(scopedTo(removed, 'updated_at')).toBe(VERSION);
  });

  it('stays pending while two black cards of that Fighter remain, the count following', async () => {
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [reviewOf('pending', { penaltyIds: ['card-a', 'card-b', 'card-black'] })],
    });

    await undo();

    const [update] = answer(db);
    expect(update?.op).toBe('update');
    expect(update?.row).toMatchObject({
      status: 'pending',
      black_card_count: 2,
      payload_json: { penaltyIds: ['card-a', 'card-b'] },
    });
  });

  // Ruled 2026-10-14: the card that reopened a dismissed review is voided → the answer is back.
  it('gives the dismissal back when the card that reopened the review is voided', async () => {
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [
        reviewOf('pending', {
          penaltyIds: ['card-a', 'card-b', 'card-black'],
          reopenedFrom: 'dismissed',
          reopenedBy: 'card-black',
        }),
      ],
    });

    await undo();

    const [update] = answer(db);
    expect(update?.row).toMatchObject({ status: 'dismissed', black_card_count: 2 });
    expect((update?.row as { payload_json: object }).payload_json).toEqual({
      penaltyIds: ['card-a', 'card-b'],
    });
    expect(scopedTo(update, 'updated_at')).toBe(VERSION);
  });

  it('keeps a reopened review pending when another card is voided and two remain', async () => {
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-c', ...elsewhere }),
      ],
      reviews: [
        reviewOf('pending', {
          penaltyIds: ['card-a', 'card-black', 'card-c'],
          reopenedFrom: 'dismissed',
          reopenedBy: 'card-c',
        }),
      ],
    });

    await undo();

    expect(answer(db)[0]?.row).toMatchObject({
      status: 'pending',
      black_card_count: 2,
      payload_json: { reopenedBy: 'card-c' },
    });
  });

  it('gives a reopened review its answer back, never removes it, below two live cards', async () => {
    const { db, undo } = setup({
      cards: [blackCard(), blackCard({ id: 'card-c', ...elsewhere })],
      reviews: [
        reviewOf('pending', {
          penaltyIds: ['card-black', 'card-c'],
          reopenedFrom: 'dismissed',
          reopenedBy: 'card-c',
        }),
      ],
    });

    await undo();

    const [update] = answer(db);
    expect(update?.op).toBe('update');
    expect(update?.row).toMatchObject({ status: 'dismissed', black_card_count: 1 });
  });

  it('a review that cannot be removed does not fail a void that landed', async () => {
    const { db, scoring, undo } = setup({ forfeit: null, reviewsFault: true });

    await expect(undo()).resolves.toMatchObject({ id: 'card-black' });
    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('is not touched by a yellow card’s void', async () => {
    const { db, undo } = setup({
      cards: [blackCard({ id: 'card-yellow', card: 'yellow' })],
      forfeit: null,
      reviews: [pending],
    });

    await undo('card-yellow');

    expect(writesTo(db, 'tournament_penalty_reviews')).toEqual([]);
  });
});
