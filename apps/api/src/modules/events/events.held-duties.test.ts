/**
 * Leaving draft resends the referees' lock messages (ruling 186). Claire locked the referee board
 * while the Winter Games, and its Winter Secret Tournament, were drafts: the send gate dropped each
 * lock message. The Event leaving draft, and then the Winter Secret going public, each send them
 * again (`lockedDutiesPublished`), whatever door the status came through: publish or the edit
 * form. A status that stays a draft, or stays public, sends nothing. The publish stands when the
 * sending fails: it is logged, as the first-publish announcement.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { EventsService } from './events.service';

const EVENT = 'e-winter';
const SECRET = 't-winter-secret';

function tables(
  eventStatus: string,
  tournamentStatus: string,
  firstPublishedAt: string | null = null,
): Record<string, TableSeed> {
  return {
    events: {
      rows: [
        {
          id: EVENT,
          organization_id: 'org-a',
          status: eventStatus,
          event_kind: 'standard',
          first_published_at: firstPublishedAt,
        },
      ],
    },
    tournaments: { rows: [{ id: SECRET, event_id: EVENT, status: tournamentStatus }] },
  };
}

let db: ReturnType<typeof mockSupabase>;
const notificationEvents = {
  lockedDutiesPublished: vi.fn(),
  organizerPublishedEvent: vi.fn(),
  resultsPublished: vi.fn(),
};

function service() {
  return new EventsService(
    db as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    notificationEvents as never,
    {} as never,
  );
}

type Act = (s: EventsService) => Promise<unknown>;

beforeEach(() => {
  for (const fn of Object.values(notificationEvents)) fn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Event leaving draft resends the lock messages', () => {
  it.each<[string, Act]>([
    ['publishing a draft Event', (s) => s.publishEvent(EVENT, 'u')],
    [
      'the edit form setting a draft Event to published',
      (s) => s.updateEvent(EVENT, { status: 'published' }, 'u'),
    ],
    [
      'the edit form moving a draft Event straight to running',
      (s) => s.updateEvent(EVENT, { status: 'running' }, 'u'),
    ],
  ])('%s', async (_, act) => {
    db = mockSupabase(tables('draft', 'draft'));
    await act(service());
    expect(notificationEvents.lockedDutiesPublished.mock.calls).toEqual([[EVENT, null]]);
    // The double ignores projections: the status the check reads must be asked for.
    expect(selectsFor(db.from, 'events')[0]).toMatch(/(^|, )status(,|$)/);
  });

  it('publishing a draft Event that was published once before, and not announcing it again', async () => {
    db = mockSupabase(tables('draft', 'draft', '2026-09-01T00:00:00Z'));
    await service().publishEvent(EVENT, 'u');
    expect(notificationEvents.lockedDutiesPublished.mock.calls).toEqual([[EVENT, null]]);
    expect(notificationEvents.organizerPublishedEvent).not.toHaveBeenCalled();
  });

  it.each<[string, string, Act]>([
    ['publishing an Event already published', 'published', (s) => s.publishEvent(EVENT, 'u')],
    ['sending a published Event back to draft', 'published', (s) => s.unpublishEvent(EVENT, 'u')],
    [
      'the edit form renaming a draft Event',
      'draft',
      (s) => s.updateEvent(EVENT, { name: 'Winter Games II' }, 'u'),
    ],
    [
      'the edit form saving a draft Event as a draft',
      'draft',
      (s) => s.updateEvent(EVENT, { status: 'draft' }, 'u'),
    ],
  ])('not %s', async (_, status, act) => {
    db = mockSupabase(tables(status, 'draft'));
    await act(service());
    expect(notificationEvents.lockedDutiesPublished).not.toHaveBeenCalled();
  });
});

describe('a Tournament going public resends its lock messages', () => {
  it.each<[string, Act]>([
    ['publishing the Winter Secret', (s) => s.publishTournament(SECRET, 'u')],
    [
      'the edit form setting it to published',
      (s) => s.updateTournament(SECRET, { status: 'published' }, 'u'),
    ],
    [
      'the edit form setting it straight to running',
      (s) => s.updateTournament(SECRET, { status: 'running' }, 'u'),
    ],
  ])('%s', async (_, act) => {
    db = mockSupabase(tables('published', 'draft'));
    await act(service());
    expect(notificationEvents.lockedDutiesPublished.mock.calls).toEqual([[EVENT, SECRET]]);
    // The double ignores projections: the status the check reads must be asked for.
    expect(selectsFor(db.from, 'tournaments')[0]).toMatch(/^(id, event_id, status|\*)$/);
  });

  it('the edit form completing a draft Tournament resends them, and sends its results', async () => {
    db = mockSupabase(tables('published', 'draft'));
    await service().updateTournament(SECRET, { status: 'completed' }, 'u');
    expect(notificationEvents.lockedDutiesPublished.mock.calls).toEqual([[EVENT, SECRET]]);
    expect(notificationEvents.resultsPublished.mock.calls).toEqual([[SECRET]]);
  });

  it('resends them before the results message, which a failure there cannot stop', async () => {
    db = mockSupabase(tables('published', 'draft'));
    notificationEvents.resultsPublished.mockRejectedValue(new Error('results down'));
    await expect(service().updateTournament(SECRET, { status: 'completed' }, 'u')).rejects.toThrow(
      'results down',
    );
    expect(notificationEvents.lockedDutiesPublished.mock.calls).toEqual([[EVENT, SECRET]]);
  });

  it.each<[string, string, Act]>([
    ['publishing it again', 'published', (s) => s.publishTournament(SECRET, 'u')],
    ['sending it back to draft', 'published', (s) => s.unpublishTournament(SECRET, 'u')],
    [
      'the edit form renaming a draft',
      'draft',
      (s) => s.updateTournament(SECRET, { name: 'Winter Open' }, 'u'),
    ],
    [
      'the edit form archiving a draft: archived is not public',
      'draft',
      (s) => s.updateTournament(SECRET, { status: 'archived' }, 'u'),
    ],
  ])('not %s', async (_, status, act) => {
    db = mockSupabase(tables('published', status));
    await act(service());
    expect(notificationEvents.lockedDutiesPublished).not.toHaveBeenCalled();
  });

  it('the publish stands when the sending fails, and the failure is logged', async () => {
    db = mockSupabase(tables('published', 'draft'));
    notificationEvents.lockedDutiesPublished.mockRejectedValue(new Error('boom'));
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(service().publishTournament(SECRET, 'u')).resolves.toMatchObject({ id: SECRET });
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      `Failed to resend the lock messages of ${SECRET}: boom`,
    );
  });
});
