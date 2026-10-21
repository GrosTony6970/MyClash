import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';
import { PenaltiesService } from './penalties.service';
import { REVIEW_CHANGED } from './second-black-card-review';

/**
 * The organiser's answer to a black card review (rulings 2026-10-14, 79, 106). It is the review's
 * own: it forgets what a card reopened, and keeps the cards it answered (a confirmed review stands
 * while two of them are live). It answers the review as the page showed it: a card that landed
 * since changed what she would be answering, so the answer is refused and the page reads it again.
 * Whatever she answers, her Fighter's status is the settle's, after the answer (slice B): there is
 * no status write to fail and no answer to put back. On an Event that is over the answer is a super
 * admin's, as every result change there.
 */
const ok = (data: unknown) => ({ data, error: null });
const SEEN = '2026-10-14T10:00:00.123456+00:00';
const SUPER_ADMIN = 'super-admin-1';
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

function answering(
  written: unknown = { id: 'rv-1', status: 'dismissed' },
  { eventStatus = 'running', guarded = true } = {},
) {
  const db = mockSupabase({
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
    tournaments: ok({ id: 't-1', event_id: 'e-1' }),
    events: ok({ id: 'e-1', organization_id: 'o-1', status: eventStatus }),
    registrations: ok(null),
    tournament_penalty_reviews: [ok(REVIEW), ok(written)],
  });
  const status = fighterStatusDouble(undefined, () => db.writes);
  const service = new PenaltiesService(
    db as never,
    { recomputeMatchScore: vi.fn() } as never,
    guarded ? new FrozenResultsGuard(db as never, {} as never) : undefined,
    undefined,
    undefined,
    undefined,
    status,
  );
  const answer = (verdict: 'confirmed' | 'dismissed', userId = 'organiser-1') =>
    service.reviewTournamentPenalty('rv-1', { status: verdict, seenUpdatedAt: SEEN }, userId);
  return { db, service, status, answer };
}

describe('answering a black card review', () => {
  it('forgets what a card reopened, and keeps the cards it answered, over the review as read', async () => {
    const { db, answer } = answering();

    await answer('dismissed');

    const [written] = writesTo(db, 'tournament_penalty_reviews');
    expect(written?.row).toMatchObject({ status: 'dismissed', reviewed_by_user_id: 'organiser-1' });
    expect((written?.row as { payload_json: object }).payload_json).toEqual({
      penaltyIds: ['c-1', 'c-2', 'c-3'],
      answeredPenaltyIds: ['c-1', 'c-2', 'c-3'],
    });
    expect(scopedTo(written, 'updated_at')).toBe(SEEN);
    expect(selectsFor(db.from, 'tournament_penalty_reviews')[0]).toBe('*');
  });

  it('refuses an answer to a review a card changed since the page showed it', async () => {
    const { db, status, service } = answering();

    const refused = service.reviewTournamentPenalty(
      'rv-1',
      { status: 'confirmed', seenUpdatedAt: '2026-10-14T09:00:00+00:00' },
      'organiser-1',
    );

    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toMatchObject({ response: { code: REVIEW_CHANGED } });
    expect(db.writes).toEqual([]);
    expect(status.calls).toEqual([]);
  });

  it('refuses, and settles nobody, when a card lands between the read and the write', async () => {
    const { db, status, answer } = answering(null);

    await expect(answer('confirmed')).rejects.toMatchObject({ response: { code: REVIEW_CHANGED } });
    expect(writesTo(db, 'registrations')).toEqual([]);
    expect(status.calls).toEqual([]);
  });

  it.each(['confirmed', 'dismissed'] as const)(
    'an answer %s settles its Fighter once it is written, and writes no status',
    async (verdict) => {
      const { db, status, answer } = answering({ id: 'rv-1', status: verdict });

      await answer(verdict);

      expect(status.calls.map((call) => call.input)).toEqual([
        { registrationId: 'r-1', tournamentId: 't-1' },
      ]);
      expect(status.calls[0]?.writesBefore.map((write) => write.table)).toEqual([
        'tournament_penalty_reviews',
      ]);
      expect(writesTo(db, 'registrations')).toEqual([]);
    },
  );

  it('a settle that fails is a server error, and the answer is not put back', async () => {
    const { db, status, answer } = answering({ id: 'rv-1', status: 'confirmed' });
    status.settle.mockRejectedValueOnce(new Error('the database is away'));

    await expect(answer('confirmed')).rejects.toThrow('the database is away');
    expect(writesTo(db, 'tournament_penalty_reviews')).toHaveLength(1);
  });
});

describe('an answer on an Event that is over', () => {
  it.each(['completed', 'archived'])(
    'is refused on an Event %s, and nothing is written or settled',
    async (eventStatus) => {
      const { db, status, answer } = answering(undefined, { eventStatus });

      await expect(answer('dismissed')).rejects.toMatchObject({
        response: { code: 'event_results_frozen' },
      });
      expect(db.writes).toEqual([]);
      expect(status.calls).toEqual([]);
    },
  );

  it('is a super admin’s', async () => {
    const { status, answer } = answering(undefined, { eventStatus: 'completed' });

    await answer('dismissed', SUPER_ADMIN);

    expect(status.calls).toHaveLength(1);
  });

  it('is refused when the over-Event check is missing, rather than taken unasked', async () => {
    const { db, answer } = answering(undefined, { guarded: false });

    await expect(answer('dismissed')).rejects.toThrow('FrozenResultsGuard');
    expect(db.writes).toEqual([]);
  });
});
