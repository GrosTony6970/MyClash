/**
 * The results notice goes out only for a Tournament the public can open (rulings 196, 197). Claire
 * builds the Winter Games as a draft and sets its Longsword Tournament to completed. Marie is on
 * the roster, and her entry is linked to her account. She is told nothing: every page of a draft
 * Event answers "not found" for her. Publishing the Event later sends nothing by itself (old news);
 * a save as completed once the Event is public does. A TEST Event is silent too: its pages are
 * hidden from everyone outside the club. The check runs when the notice is queued, so a refused one
 * leaves no job behind to swallow the later send; the log says it was dropped.
 */
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const LONGSWORD = 't-longsword';
const MARIE = 'u-marie';

type EventEmbed = { status?: string; event_kind?: string } | null;

function tables(tournamentStatus: string, events: EventEmbed): Record<string, TableSeed> {
  return {
    tournaments: {
      rows: [{ id: LONGSWORD, name: 'Longsword', status: tournamentStatus, events }],
    },
    registrations: {
      rows: [
        { tournament_id: LONGSWORD, person_id: 'p-marie' },
        // On the roster with no linked account: nobody to tell.
        { tournament_id: LONGSWORD, person_id: 'p-paul' },
      ],
    },
    persons: {
      rows: [
        { id: 'p-marie', claimed_by_user_id: MARIE, email: 'marie@example.com' },
        { id: 'p-paul', claimed_by_user_id: null, email: 'paul@example.com' },
      ],
    },
  };
}

const scheduler = { sendImmediate: vi.fn() };
let db: ReturnType<typeof mockSupabase>;

async function told(seed: Record<string, TableSeed>): Promise<unknown[]> {
  db = mockSupabase(seed);
  await new NotificationEventsService(db as never, scheduler as never).resultsPublished(LONGSWORD);
  return scheduler.sendImmediate.mock.calls.map(([job]) => job as unknown);
}

let log: MockInstance<Logger['log']>;

beforeEach(() => {
  scheduler.sendImmediate.mockReset();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the results notice of a completed Tournament', () => {
  it.each<[string, string]>([
    ['a published Event', 'published'],
    ['a running Event', 'running'],
    ['a completed Event', 'completed'],
  ])('tells Marie in %s', async (_, status) => {
    const jobs = await told(tables('completed', { status, event_kind: 'standard' }));
    expect(log).not.toHaveBeenCalled();
    expect(jobs).toEqual([
      {
        kind: 'results_published',
        entityId: LONGSWORD,
        userId: MARIE,
        title: 'Results published',
        body: 'Longsword results are now published.',
        url: '/notifications',
        email: 'marie@example.com',
        emailSubject: 'Results published',
        preference: 'results_published',
      },
    ]);
  });

  it('tells Marie in a club Event: its pages are public', async () => {
    const jobs = await told(tables('completed', { status: 'running', event_kind: 'club' }));
    expect(jobs).toHaveLength(1);
  });

  it.each<[string, string, EventEmbed]>([
    ['a draft Event (ruling 196)', 'completed', { status: 'draft', event_kind: 'standard' }],
    ['a running TEST Event (ruling 197)', 'completed', { status: 'running', event_kind: 'test' }],
    ['a draft TEST Event', 'completed', { status: 'draft', event_kind: 'test' }],
    ['an Event read without its status', 'completed', { event_kind: 'standard' }],
    ['a Tournament read without its Event', 'completed', null],
    [
      'a public Event, the Tournament sent back to draft meanwhile',
      'draft',
      { status: 'published', event_kind: 'standard' },
    ],
  ])('tells nobody in %s, and says so in the log', async (_, tournamentStatus, events) => {
    expect(await told(tables(tournamentStatus, events))).toEqual([]);
    expect(log).toHaveBeenCalledWith(`Dropped results_published for ${LONGSWORD}: hidden or gone`);
  });

  it('tells nobody about a Tournament that is gone', async () => {
    const seed = tables('completed', { status: 'published', event_kind: 'standard' });
    expect(await told({ ...seed, tournaments: { rows: [] } })).toEqual([]);
    expect(log).toHaveBeenCalledWith(`Dropped results_published for ${LONGSWORD}: hidden or gone`);
  });

  it('reads the Tournament with its status, and its Event with status and kind', async () => {
    await told(tables('completed', { status: 'published', event_kind: 'standard' }));
    // The double ignores projections: a kind left out of the read would count as a standard Event.
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      'id, name, status, events(status, event_kind)',
    ]);
  });

  it('a failed Tournament read is an error, not a silent "nobody to tell" (ruling 192)', async () => {
    const seed = tables('completed', { status: 'published', event_kind: 'standard' });
    const failure = await told({
      ...seed,
      tournaments: { data: null, error: { message: 'boom' } },
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('Results notice: Tournament read failed: boom');
    expect(scheduler.sendImmediate).not.toHaveBeenCalled();
  });
});
