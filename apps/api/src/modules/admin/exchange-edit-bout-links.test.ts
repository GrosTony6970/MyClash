import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { boutLinks } from './exchange-edit-bout-links';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';

/**
 * A correction request in the review queue links to its bout.
 *
 * Marc, a super admin, reads "FAL 2026 · L1-P1-M03 · #7" in the queue. To judge
 * the request he needs the bout's sheet, and the row gave him no way to it.
 */
const request = (id: string, eventId: string, matchId: string) => ({
  id,
  event_id: eventId,
  match_id: matchId,
  exchange_id: `hit-of-${id}`,
  requested_by_user_id: 'user-1',
  reviewed_by_user_id: null,
  request_type: 'void_exchange',
  requested_payload: {},
});

const EVENTS = {
  rows: [
    { id: 'event-1', organizations: { slug: 'les-lames' } },
    // The typed client reads a to-one embed as an array.
    { id: 'event-2', organizations: [{ slug: 'salle-d-armes' }] },
    // A decoy: no request names it.
    { id: 'event-9', organizations: { slug: 'another-club' } },
  ],
};

const logger = () => ({ warn: vi.fn() });

describe('boutLinks', () => {
  it('links each request to its bout’s page in the organiser app', async () => {
    const db = mockSupabase({ events: EVENTS });

    const links = await boutLinks({ supabase: db as never, logger: logger() as never }, [
      request('r1', 'event-1', 'm1'),
      request('r2', 'event-2', 'm2'),
      request('r3', 'event-1', 'm3'),
    ]);

    expect([...links]).toEqual([
      ['r1', '/org/les-lames/events/event-1/matches/m1'],
      ['r2', '/org/salle-d-armes/events/event-2/matches/m2'],
      ['r3', '/org/les-lames/events/event-1/matches/m3'],
    ]);
    expect(selectsFor(db.from, 'events')).toEqual(['id, organizations!inner(slug)']);
    // One read for the Events of the whole list, each named once.
    expect(filtersFor(db.from, 'events', 'in')).toEqual([['id', ['event-1', 'event-2']]]);
  });

  it('a request whose Event no longer resolves has no link', async () => {
    const db = mockSupabase({ events: EVENTS });

    const links = await boutLinks({ supabase: db as never, logger: logger() as never }, [
      request('r1', 'event-gone', 'm1'),
      request('r2', 'event-2', 'm2'),
    ]);

    expect([...links.keys()]).toEqual(['r2']);
  });

  it('no request: nothing is read', async () => {
    const db = mockSupabase({ events: EVENTS });

    expect((await boutLinks({ supabase: db as never, logger: logger() as never }, [])).size).toBe(
      0,
    );
    expect(db.from).not.toHaveBeenCalled();
  });

  it('a failed read gives no link and a warning, not a failed list', async () => {
    const db = mockSupabase({ events: { data: null, error: { message: 'the database is away' } } });
    const log = logger();

    const links = await boutLinks({ supabase: db as never, logger: log as never }, [
      request('r1', 'event-1', 'm1'),
    ]);

    expect(links.size).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      'No bout links for the correction requests: the database is away',
    );
  });
});

describe('ExchangeEditRequestsAdminService.list', () => {
  function listed(rows: ReturnType<typeof request>[]) {
    const db = mockSupabase({ events: EVENTS });
    const frozenResults = { listRequests: vi.fn().mockResolvedValue(rows) };
    const labels = { resolve: vi.fn().mockResolvedValue({ labels: new Map(), users: new Map() }) };
    const service = new ExchangeEditRequestsAdminService(
      frozenResults as never,
      {} as never,
      labels as never,
      db as never,
    );
    return service.list({ status: 'pending' });
  }

  it('hands each request the link of its bout, or null', async () => {
    const rows = await listed([request('r1', 'event-1', 'm1'), request('r2', 'event-gone', 'm2')]);

    expect(rows.map((row) => [row.id, row.boutHref])).toEqual([
      ['r1', '/org/les-lames/events/event-1/matches/m1'],
      ['r2', null],
    ]);
  });
});
