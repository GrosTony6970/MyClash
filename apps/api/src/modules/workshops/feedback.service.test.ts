/**
 * feedback.service.test.ts — workshop ratings (Phase 4).
 *
 * Covers the eligibility gate (enrolled + session started), the upsert on
 * submit, and the anonymous aggregate (no rater identity projected).
 */

import { describe, expect, it } from 'vitest';
import { FeedbackService } from './feedback.service';

type Session = { id: string; starts_at: string | null; status: string | null };
type Enrollment = { status: string };
type FeedbackRow = { rating: number; comment: string | null; created_at: string };

interface FakeOpts {
  sessions?: Session[];
  enrollments?: Enrollment[];
  feedbackRows?: FeedbackRow[];
  myFeedback?: { rating: number; comment: string | null } | null;
}

function buildFake(opts: FakeOpts) {
  const captures: { upsert: Record<string, unknown> | null } = { upsert: null };

  function table(name: string): Record<string, unknown> {
    if (name === 'workshop_sessions') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.sessions ?? [], error: null }),
        }),
      };
    }
    if (name === 'workshop_enrollments') {
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: opts.enrollments ?? [], error: null }),
          }),
        }),
      };
    }
    // workshop_feedback — chainable, supports upsert/select/eq/order/single/maybeSingle.
    const builder: Record<string, unknown> = {
      upsert: (payload: Record<string, unknown>) => {
        captures.upsert = payload;
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: opts.feedbackRows ?? [], error: null }),
      single: () =>
        Promise.resolve({
          data: {
            rating: captures.upsert?.['rating'] ?? null,
            comment: captures.upsert?.['comment'] ?? null,
          },
          error: null,
        }),
      maybeSingle: () => Promise.resolve({ data: opts.myFeedback ?? null, error: null }),
    };
    return builder;
  }

  return {
    supabase: { service: { from: (n: string) => table(n) } },
    captures,
  };
}

const startedSession: Session = {
  id: 's-1',
  starts_at: '2000-01-01T00:00:00.000Z',
  status: 'completed',
};
const futureSession: Session = {
  id: 's-2',
  starts_at: '2999-01-01T00:00:00.000Z',
  status: 'scheduled',
};

describe('FeedbackService.submitFeedback', () => {
  it('rejects when no session has started yet', async () => {
    const fake = buildFake({ sessions: [futureSession], enrollments: [{ status: 'confirmed' }] });
    const svc = new FeedbackService(fake.supabase as never);
    await expect(svc.submitFeedback('w-1', 'p-1', 5, 'great')).rejects.toThrow(/started/i);
  });

  it('rejects when the person is not an eligible attendee', async () => {
    const fake = buildFake({ sessions: [startedSession], enrollments: [{ status: 'refused' }] });
    const svc = new FeedbackService(fake.supabase as never);
    await expect(svc.submitFeedback('w-1', 'p-1', 4, null)).rejects.toThrow(/attendee/i);
  });

  it('upserts the rating when enrolled in a started session', async () => {
    const fake = buildFake({ sessions: [startedSession], enrollments: [{ status: 'confirmed' }] });
    const svc = new FeedbackService(fake.supabase as never);

    const res = await svc.submitFeedback('w-1', 'p-1', 4, '  solid  ');

    expect(res).toEqual({ rating: 4, comment: 'solid' });
    expect(fake.captures.upsert).toMatchObject({
      workshop_id: 'w-1',
      rater_person_id: 'p-1',
      rating: 4,
      comment: 'solid',
    });
  });
});

describe('FeedbackService.getWorkshopFeedback', () => {
  it('computes an anonymous aggregate (average, distribution, comments only)', async () => {
    const fake = buildFake({
      feedbackRows: [
        { rating: 5, comment: 'excellent', created_at: '2026-01-03T00:00:00Z' },
        { rating: 4, comment: '  ', created_at: '2026-01-02T00:00:00Z' },
        { rating: 3, comment: 'ok', created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    const svc = new FeedbackService(fake.supabase as never);

    const summary = await svc.getWorkshopFeedback('w-1');

    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4);
    expect(summary.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
    // Blank comment dropped; no rater identity present on any entry.
    expect(summary.comments).toEqual([
      { rating: 5, comment: 'excellent', createdAt: '2026-01-03T00:00:00Z' },
      { rating: 3, comment: 'ok', createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('returns a null average when there is no feedback', async () => {
    const fake = buildFake({ feedbackRows: [] });
    const svc = new FeedbackService(fake.supabase as never);
    const summary = await svc.getWorkshopFeedback('w-1');
    expect(summary).toEqual({
      average: null,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      comments: [],
    });
  });
});
