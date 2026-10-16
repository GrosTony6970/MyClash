import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchesService } from './matches.service';

/**
 * A repeated `client_uuid` answers the SAVED row before any refusal.
 *
 * The pad sends a hit, the server saves it, and the answer is lost (the wifi
 * drops, the tab closes). The hit stays in the pad's queue. If the Event is
 * completed before the queue drains again, the guard used to refuse the replay
 * with a 409, and the pad could not tell that hit from one the server never
 * took. The REAL guard is under test, over the same seeded database.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000001';
const SAVED = {
  id: 'ex-1',
  client_uuid: 'uuid-saved',
  match_id: 'm1',
  sequence: 3,
  recorded_at: '2026-10-03T10:00:05.000Z',
};
const HIT = { sequence: 3, type: 'no_exchange', occurredAt: '2026-10-03T10:00:00.000Z' };

function setup(eventStatus: string, lockedAt: string | null = null, bout: object = {}) {
  const db = mockSupabase({
    exchanges: { rows: [SAVED] },
    matches: {
      rows: [
        {
          id: 'm1',
          phase_id: 'phase-1',
          locked_at: lockedAt,
          status: 'running',
          back_in_play_at: null,
          ...bout,
        },
      ],
    },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1' }] },
    events: { rows: [{ id: 'event-1', status: eventStatus }] },
    platform_roles: { rows: [] },
  });
  const scoring = { recomputeMatchScore: vi.fn() };
  const service = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
    new FrozenResultsGuard(db as never, {} as never),
  );
  return { db, scoring, service };
}

describe('MatchesService.createExchange — a repeated hit on an over Event', () => {
  it.each<'completed' | 'archived'>(['completed', 'archived'])(
    'answers the saved row on a %s Event, and writes nothing',
    async (status) => {
      const { db, scoring, service } = setup(status);

      await expect(
        service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
          userId: ORGANISER,
        }),
      ).resolves.toEqual(SAVED);
      expect(db.writes).toEqual([]);
      expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    },
  );

  it('answers the saved row on a locked bout too', async () => {
    const { db, service } = setup('running', '2026-10-03T09:00:00.000Z');

    await expect(
      service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
        userId: ORGANISER,
      }),
    ).resolves.toEqual(SAVED);
    expect(db.writes).toEqual([]);
  });

  // The hit was saved and its recompute threw (a ruleset read that failed): the resend scores
  // the bout, on an Event still running (`scoreReplayedHit`).
  it('scores the bout again on a running Event, and answers the saved row', async () => {
    const { scoring, service } = setup('running');

    await expect(
      service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
        userId: ORGANISER,
      }),
    ).resolves.toEqual(SAVED);
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1', undefined);
  });

  // The bout ended on this hit, its answer was lost; the desk pressed Reopen to correct it
  // (ruling 331: its sheet is not read again). The resend must not complete it again.
  it('does not score a bout put back in play after the hit was saved', async () => {
    const { scoring, service } = setup('running', null, {
      status: 'paused',
      back_in_play_at: '2026-10-03T10:01:00.000Z',
    });

    await expect(
      service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
        userId: ORGANISER,
      }),
    ).resolves.toEqual(SAVED);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('scores a bout put back in play before the hit was saved', async () => {
    const { scoring, service } = setup('running', null, {
      back_in_play_at: '2026-10-03T09:59:00.000Z',
    });

    await service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
      userId: ORGANISER,
    });
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1', undefined);
  });

  it('does not score a voided bout: its sheet stays', async () => {
    const { scoring, service } = setup('running', null, { status: 'voided' });

    await service.createExchange('m1', { ...HIT, clientUuid: 'uuid-saved' } as never, {
      userId: ORGANISER,
    });
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  // Archived too: the route passes the archived lock (ruling 240), so this
  // refusal is the one a new hit meets there.
  it.each<'completed' | 'archived'>(['completed', 'archived'])(
    'still refuses a hit the server does not hold, on a %s Event',
    async (status) => {
      const { db, service } = setup(status);

      await expect(
        service.createExchange('m1', { ...HIT, clientUuid: 'uuid-new' } as never, {
          userId: ORGANISER,
        }),
      ).rejects.toEqual(
        new ConflictException({
          message: 'Event results are frozen',
          code: 'event_results_frozen',
        }),
      );
      expect(db.writes).toEqual([]);
    },
  );
});
