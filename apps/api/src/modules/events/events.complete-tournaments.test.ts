/**
 * Ruling 892: an Event that completes completes every Tournament still open. Sam saves the
 * Longsword Open's Event as completed the morning after: its pools-only side tournament, which
 * nothing else would ever complete, completes with it, and its fighters get their results.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { EventsService } from './events.service';

const EVENT = 'e-open';

function setup(status: string) {
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT,
          organization_id: 'org-a',
          status,
          event_kind: 'standard',
          first_published_at: '2026-09-01T00:00:00Z',
        },
      ],
    },
    tournaments: { rows: [] },
  });
  const order: string[] = [];
  const completion = {
    completeOpenTournaments: vi.fn(async () => (order.push('complete'), ['t-pools'])),
    reopenUnfinishedOfEvent: vi.fn().mockResolvedValue(undefined),
  };
  const leagues = { recomputeForEvent: vi.fn(async () => void order.push('recompute')) };
  // Positional, as Nest builds it: the completion service is the last constructor argument.
  const service = new EventsService(
    db as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    { lockedDutiesPublished: vi.fn(), organizerPublishedEvent: vi.fn() } as never,
    {} as never,
    leagues as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    completion as never,
  );
  return { service, completion, order };
}

describe('an Event saved as completed completes its open Tournaments (ruling 892)', () => {
  it('completes them, before the league recompute reads them', async () => {
    const { service, completion, order } = setup('running');

    await service.updateEvent(EVENT, { status: 'completed' }, 'u');

    expect(completion.completeOpenTournaments).toHaveBeenCalledWith(EVENT, { announce: true });
    expect(order).toEqual(['complete', 'recompute']);
  });

  it('completes them silently when the Event goes straight from draft: old news (ruling 190)', async () => {
    const { service, completion } = setup('draft');

    await service.updateEvent(EVENT, { status: 'completed' }, 'u');

    expect(completion.completeOpenTournaments).toHaveBeenCalledWith(EVENT, { announce: false });
  });

  it('runs again the unfinished ones when the Event is put back from completed', async () => {
    const { service, completion } = setup('completed');

    await service.updateEvent(EVENT, { status: 'running' }, 'u');

    expect(completion.reopenUnfinishedOfEvent).toHaveBeenCalledWith(EVENT);
    expect(completion.completeOpenTournaments).not.toHaveBeenCalled();
  });

  it('leaves them alone on any other save', async () => {
    const { service, completion } = setup('published');

    await service.updateEvent(EVENT, { status: 'running' }, 'u');

    expect(completion.completeOpenTournaments).not.toHaveBeenCalled();
    expect(completion.reopenUnfinishedOfEvent).not.toHaveBeenCalled();
  });
});
