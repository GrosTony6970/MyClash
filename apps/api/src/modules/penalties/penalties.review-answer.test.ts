import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { PenaltiesService } from './penalties.service';

/**
 * The organiser's answer to a black card review is the review's own (ruled 2026-10-14): once
 * answered, it no longer remembers what a later card had reopened, so voiding that card later
 * cannot hand back an answer older than this one.
 */
const ok = (data: unknown) => ({ data, error: null });

describe('answering a black card review', () => {
  it('forgets what a card reopened, and keeps the cards it counted', async () => {
    const db = mockSupabase({
      platform_roles: ok(null),
      tournaments: ok({ event_id: 'e-1' }),
      events: ok({ organization_id: 'o-1' }),
      tournament_penalty_reviews: [
        ok({
          id: 'rv-1',
          tournament_id: 't-1',
          registration_id: 'r-1',
          status: 'pending',
          payload_json: {
            penaltyIds: ['c-1', 'c-2', 'c-3'],
            reopenedFrom: 'dismissed',
            reopenedBy: 'c-3',
          },
        }),
        ok({ id: 'rv-1', status: 'dismissed' }),
      ],
    });
    const service = new PenaltiesService(db as never, { recomputeMatchScore: vi.fn() } as never);

    await service.reviewTournamentPenalty('rv-1', { status: 'dismissed' }, 'organiser-1');

    const [answer] = writesTo(db, 'tournament_penalty_reviews');
    expect(answer?.row).toMatchObject({
      status: 'dismissed',
      reviewed_by_user_id: 'organiser-1',
      payload_json: { penaltyIds: ['c-1', 'c-2', 'c-3'] },
    });
    expect((answer?.row as { payload_json: object }).payload_json).not.toHaveProperty(
      'reopenedFrom',
    );
    expect(selectsFor(db.from, 'tournament_penalty_reviews')[0]).toBe('*');
  });
});
