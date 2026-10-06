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
  const pending = {
    id: 'review-1',
    tournament_id: 'tournament-1',
    registration_id: 'reg-blue',
    review_type: 'second_black_card',
    status: 'pending',
  };

  it('is removed when fewer than two black cards remain, and only while pending', async () => {
    const { db, undo } = setup({ reviews: [pending] });

    await undo();

    const [removed] = writesTo(db, 'tournament_penalty_reviews');
    expect(removed?.op).toBe('delete');
    expect(scopedTo(removed, 'tournament_id')).toBe('tournament-1');
    expect(scopedTo(removed, 'registration_id')).toBe('reg-blue');
    expect(scopedTo(removed, 'status')).toBe('pending');
  });

  it('stays while two black cards of that Fighter remain in the Tournament', async () => {
    const elsewhere = { match_id: 'm7' };
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [pending],
    });

    await undo();

    expect(writesTo(db, 'tournament_penalty_reviews')).toEqual([]);
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
