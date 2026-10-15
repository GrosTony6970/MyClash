import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { PenaltiesService } from './penalties.service';
import { REVIEW_CHANGED } from './second-black-card-review';

/**
 * The organiser's answer to a black card review (rulings 2026-10-14). It is the review's own:
 * it forgets what a card reopened. And it answers the review as the page showed it: a card that
 * landed since changed what she would be answering, so the answer is refused and the page reads
 * it again. A refused answer disqualifies nobody.
 */
const ok = (data: unknown) => ({ data, error: null });
const SEEN = '2026-10-14T10:00:00.123456+00:00';
const REVIEW = {
  id: 'rv-1',
  tournament_id: 't-1',
  registration_id: 'r-1',
  status: 'pending',
  updated_at: SEEN,
  payload_json: {
    penaltyIds: ['c-1', 'c-2', 'c-3'],
    reopenedFrom: 'dismissed',
    reopenedBy: 'c-3',
    answeredIds: ['c-1', 'c-2'],
  },
};

function answering(written: unknown = { id: 'rv-1', status: 'dismissed' }) {
  const db = mockSupabase({
    platform_roles: ok(null),
    tournaments: ok({ event_id: 'e-1' }),
    events: ok({ organization_id: 'o-1' }),
    registrations: ok(null),
    tournament_penalty_reviews: [ok(REVIEW), ok(written)],
  });
  const service = new PenaltiesService(db as never, { recomputeMatchScore: vi.fn() } as never);
  return { db, service };
}

describe('answering a black card review', () => {
  it('forgets what a card reopened, over the review as it was read', async () => {
    const { db, service } = answering();

    await service.reviewTournamentPenalty(
      'rv-1',
      { status: 'dismissed', seenUpdatedAt: SEEN },
      'organiser-1',
    );

    const [answer] = writesTo(db, 'tournament_penalty_reviews');
    expect(answer?.row).toMatchObject({
      status: 'dismissed',
      reviewed_by_user_id: 'organiser-1',
      payload_json: { penaltyIds: ['c-1', 'c-2', 'c-3'] },
    });
    expect((answer?.row as { payload_json: object }).payload_json).toEqual({
      penaltyIds: ['c-1', 'c-2', 'c-3'],
    });
    expect(scopedTo(answer, 'updated_at')).toBe(SEEN);
    expect(selectsFor(db.from, 'tournament_penalty_reviews')[0]).toBe('*');
  });

  it('refuses an answer to a review a card changed since the page showed it', async () => {
    const { db, service } = answering();

    const refused = service.reviewTournamentPenalty(
      'rv-1',
      { status: 'confirmed', seenUpdatedAt: '2026-10-14T09:00:00+00:00' },
      'organiser-1',
    );

    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toMatchObject({ response: { code: REVIEW_CHANGED } });
    expect(db.writes).toEqual([]);
  });

  it('refuses, and disqualifies nobody, when a card lands between the read and the write', async () => {
    const { db, service } = answering(null);

    await expect(
      service.reviewTournamentPenalty(
        'rv-1',
        { status: 'confirmed', seenUpdatedAt: SEEN },
        'organiser-1',
      ),
    ).rejects.toMatchObject({ response: { code: REVIEW_CHANGED } });
    expect(writesTo(db, 'registrations')).toEqual([]);
  });

  it('disqualifies the fighter once the confirmation is written', async () => {
    const { db, service } = answering({ id: 'rv-1', status: 'confirmed' });

    await service.reviewTournamentPenalty(
      'rv-1',
      { status: 'confirmed', seenUpdatedAt: SEEN },
      'organiser-1',
    );

    expect(db.writes.map((w) => w.table)).toEqual(['tournament_penalty_reviews', 'registrations']);
    expect(writesTo(db, 'registrations')[0]?.row).toEqual({ status: 'disqualified' });
  });

  it('puts the review back, and says so, when the disqualification is not written', async () => {
    const WRITTEN = '2026-10-15T20:00:00.000000+00:00';
    const db = mockSupabase({
      platform_roles: ok(null),
      tournaments: ok({ event_id: 'e-1' }),
      events: ok({ organization_id: 'o-1' }),
      registrations: { data: null, error: { message: 'connection reset' } },
      tournament_penalty_reviews: [
        ok(REVIEW),
        ok({ id: 'rv-1', status: 'confirmed', updated_at: WRITTEN }),
        ok(null),
      ],
    });
    const service = new PenaltiesService(db as never, { recomputeMatchScore: vi.fn() } as never);

    await expect(
      service.reviewTournamentPenalty(
        'rv-1',
        { status: 'confirmed', seenUpdatedAt: SEEN },
        'organiser-1',
      ),
    ).rejects.toThrow(/not disqualified: connection reset/);

    const [answer, putBack] = writesTo(db, 'tournament_penalty_reviews');
    expect(answer?.row).toMatchObject({ status: 'confirmed' });
    expect(putBack?.row).toMatchObject({ status: 'pending', payload_json: REVIEW.payload_json });
    expect(scopedTo(putBack, 'updated_at')).toBe(WRITTEN);
  });
});
