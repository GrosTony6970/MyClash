import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  answeredPayload,
  nextReview,
  syncSecondBlackCardReview,
  type ReviewStatus,
} from './second-black-card-review';

/**
 * The review a second black card asks for (operator rulings, 2026-10-14): a new black card puts
 * it back to pending with the new count, whatever its state; a confirmed disqualification stays
 * confirmed; a failed write is a server error. A third card used to meet the table's unique row
 * and fail in silence.
 */

const ok = (data: unknown) => ({ data, error: null });
const cards = (...ids: string[]) => ok(ids.map((id) => ({ id })));
const review = (
  status: ReviewStatus,
  penaltyIds: string[],
  extra: Record<string, unknown> = {},
) => ({
  id: 'rv-1',
  status,
  black_card_count: penaltyIds.length,
  payload_json: { penaltyIds, ...extra },
  updated_at: '2026-10-14T10:00:00.123456+00:00',
});
const WROTE = ok([{ id: 'rv-1' }]);
const MISSED = ok([]);

function run(seed: Record<string, unknown>, card = 'c-3') {
  const db = mockSupabase(seed as never);
  const done = syncSecondBlackCardReview(
    db.service as unknown as SupabaseService['service'],
    't-1',
    'r-1',
    card,
  );
  return { db, done };
}

describe('nextReview', () => {
  it('reopens a dismissed review for a card it has not counted, and remembers its answer', () => {
    expect(nextReview(review('dismissed', ['c-1', 'c-2']), ['c-1', 'c-2', 'c-3'], 'c-3')).toEqual({
      status: 'pending',
      black_card_count: 3,
      payload_json: {
        penaltyIds: ['c-1', 'c-2', 'c-3'],
        reopenedFrom: 'dismissed',
        reopenedBy: 'c-3',
      },
    });
  });

  it('never reopens for a card it already counted: a card sent again is not new', () => {
    expect(nextReview(review('dismissed', ['c-1', 'c-2']), ['c-1', 'c-2'], 'c-2').status).toBe(
      'dismissed',
    );
  });

  it('keeps a confirmed disqualification confirmed, with the new count', () => {
    const next = nextReview(review('confirmed', ['c-1', 'c-2']), ['c-1', 'c-2', 'c-3'], 'c-3');
    expect(next).toMatchObject({ status: 'confirmed', black_card_count: 3 });
    expect(next.payload_json).not.toHaveProperty('reopenedFrom');
  });
});

describe('syncSecondBlackCardReview', () => {
  it('opens a pending review at the second card', async () => {
    const { db, done } = run(
      {
        match_penalties: cards('c-1', 'c-2'),
        tournament_penalty_reviews: [ok(null), ok(null)],
      },
      'c-2',
    );
    await done;
    const [insert] = writesTo(db, 'tournament_penalty_reviews');
    expect(insert?.op).toBe('insert');
    expect(insert?.row).toMatchObject({
      tournament_id: 't-1',
      registration_id: 'r-1',
      review_type: 'second_black_card',
      status: 'pending',
      black_card_count: 2,
      payload_json: { penaltyIds: ['c-1', 'c-2'] },
    });
    expect(selectsFor(db.from, 'match_penalties')).toEqual(['id']);
    expect(selectsFor(db.from, 'tournament_penalty_reviews')).toEqual([
      'id, status, black_card_count, payload_json, updated_at',
    ]);
  });

  it('counts a third card on a pending review, over the review as it was read', async () => {
    const { db, done } = run({
      match_penalties: cards('c-1', 'c-2', 'c-3'),
      tournament_penalty_reviews: [ok(review('pending', ['c-1', 'c-2'])), WROTE],
    });
    await done;
    const [update] = writesTo(db, 'tournament_penalty_reviews');
    expect(update?.op).toBe('update');
    expect(update?.row).toMatchObject({ status: 'pending', black_card_count: 3 });
    expect(scopedTo(update, 'id')).toBe('rv-1');
    expect(scopedTo(update, 'updated_at')).toBe('2026-10-14T10:00:00.123456+00:00');
  });

  it('puts a dismissed review back to pending at a new card', async () => {
    const { db, done } = run({
      match_penalties: cards('c-1', 'c-2', 'c-3'),
      tournament_penalty_reviews: [ok(review('dismissed', ['c-1', 'c-2'])), WROTE],
    });
    await done;
    expect(writesTo(db, 'tournament_penalty_reviews')[0]?.row).toMatchObject({
      status: 'pending',
      payload_json: { reopenedFrom: 'dismissed', reopenedBy: 'c-3' },
    });
  });

  it('writes nothing for a card sent again that changes nothing', async () => {
    const { db, done } = run(
      {
        match_penalties: cards('c-1', 'c-2'),
        tournament_penalty_reviews: [ok(review('dismissed', ['c-1', 'c-2']))],
      },
      'c-2',
    );
    await done;
    expect(writesTo(db, 'tournament_penalty_reviews')).toEqual([]);
  });

  it('asks nothing of the reviews below two live cards', async () => {
    const { db, done } = run({ match_penalties: cards('c-1') }, 'c-1');
    await done;
    expect(queriedTables(db.from)).toEqual(['match_penalties']);
  });

  it('meets the review a card written at the same time just made, and counts over it', async () => {
    const { db, done } = run({
      match_penalties: cards('c-1', 'c-2', 'c-3'),
      tournament_penalty_reviews: [
        ok(null),
        { data: null, error: { message: 'duplicate key', code: '23505' } },
        ok(review('pending', ['c-1', 'c-2'])),
        WROTE,
      ],
    });
    await done;
    expect(writesTo(db, 'tournament_penalty_reviews').map((w) => w.op)).toEqual([
      'insert',
      'update',
    ]);
  });

  it('reads again when the review moved since it was read, and says so at a second miss', async () => {
    const once = run({
      match_penalties: cards('c-1', 'c-2', 'c-3'),
      tournament_penalty_reviews: [
        ok(review('pending', ['c-1', 'c-2'])),
        MISSED,
        ok(review('dismissed', ['c-1', 'c-2'])),
        WROTE,
      ],
    });
    await once.done;
    expect(writesTo(once.db, 'tournament_penalty_reviews')[1]?.row).toMatchObject({
      status: 'pending',
      payload_json: { reopenedFrom: 'dismissed' },
    });

    const twice = run({
      match_penalties: cards('c-1', 'c-2', 'c-3'),
      tournament_penalty_reviews: [ok(review('pending', ['c-1', 'c-2'])), MISSED],
    });
    await expect(twice.done).rejects.toThrow('changed twice while it was written');
  });

  it('throws a failed read or write: a server error, never a review left as it was', async () => {
    await expect(
      run({ match_penalties: { data: null, error: { message: 'down' } } }).done,
    ).rejects.toThrow('The black cards could not be read: down');
    await expect(
      run({
        match_penalties: cards('c-1', 'c-2'),
        tournament_penalty_reviews: { data: null, error: { message: 'down' } },
      }).done,
    ).rejects.toThrow('The black card review could not be read: down');
    await expect(
      run({
        match_penalties: cards('c-1', 'c-2'),
        tournament_penalty_reviews: [ok(null), { data: null, error: { message: 'refused' } }],
      }).done,
    ).rejects.toThrow('The black card review could not be written: refused');
  });
});

describe('answeredPayload', () => {
  it('forgets what a card reopened once the organiser answers', () => {
    expect(
      answeredPayload({ penaltyIds: ['c-1'], reopenedFrom: 'dismissed', reopenedBy: 'c-3' }),
    ).toEqual({ penaltyIds: ['c-1'] });
  });
});
