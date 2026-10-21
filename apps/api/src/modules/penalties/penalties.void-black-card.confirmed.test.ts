import { describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { blackCard, setup } from './penalties.void-black-card.fixtures';
import { nextReview } from './second-black-card-review';

/**
 * Ruling 106: two black cards, the review confirmed, the Fighter disqualified; the referee takes a
 * card back. The confirmation stood on the cards the organiser answered (`answeredPenaltyIds`), so
 * it stands while two of them are live. Below that it asks her again when two live cards remain (a
 * 3rd card nobody answered), and is dismissed by the void otherwise; a later 2nd card asks again.
 * The Fighter's status is the settle's, once the review is written.
 */
const VERSION = '2026-10-14T10:00:00.123456+00:00';
const elsewhere = { match_id: 'm7' };
const confirmed = (penaltyIds: string[], answeredPenaltyIds: string[]) => ({
  id: 'review-1',
  tournament_id: 'tournament-1',
  registration_id: 'reg-blue',
  review_type: 'second_black_card',
  status: 'confirmed',
  black_card_count: penaltyIds.length,
  payload_json: { penaltyIds, answeredPenaltyIds },
  updated_at: VERSION,
});
const reviewWrite = (db: Parameters<typeof writesTo>[0]) =>
  writesTo(db, 'tournament_penalty_reviews')[0];

describe('a confirmed review once a black card is taken back (ruling 106)', () => {
  it('is dismissed by the void when fewer than two cards remain, then the Fighter is settled', async () => {
    const { db, status, undo } = setup({
      cards: [blackCard(), blackCard({ id: 'card-x', ...elsewhere })],
      reviews: [confirmed(['card-x', 'card-black'], ['card-x', 'card-black'])],
    });

    await undo();

    expect(reviewWrite(db)?.row).toMatchObject({
      status: 'dismissed',
      black_card_count: 1,
      payload_json: { penaltyIds: ['card-x'], dismissedBy: 'card_void' },
    });
    expect(status.calls.at(-1)?.writesBefore.map((write) => write.table)).toContain(
      'tournament_penalty_reviews',
    );
  });

  it('asks again when two cards remain but one of them nobody answered', async () => {
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [confirmed(['card-a', 'card-black', 'card-b'], ['card-a', 'card-black'])],
    });

    await undo();

    expect(reviewWrite(db)?.row).toMatchObject({
      status: 'pending',
      black_card_count: 2,
      payload_json: { penaltyIds: ['card-a', 'card-b'] },
    });
  });

  it('stands while two of the cards it answered are live', async () => {
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [confirmed(['card-a', 'card-b', 'card-black'], ['card-a', 'card-b'])],
    });

    await undo();

    expect(reviewWrite(db)?.row).toMatchObject({
      status: 'confirmed',
      black_card_count: 2,
      payload_json: { penaltyIds: ['card-a', 'card-b'], answeredPenaltyIds: ['card-a', 'card-b'] },
    });
  });

  it('a review the void dismissed is asked again by a new 2nd card', () => {
    const dismissed = {
      status: 'dismissed' as const,
      payload_json: { penaltyIds: ['card-x'], dismissedBy: 'card_void' },
    };

    expect(nextReview(dismissed, ['card-x', 'card-new'], 'card-new')).toMatchObject({
      status: 'pending',
      black_card_count: 2,
    });
  });
});
