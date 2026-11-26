import { describe, expect, it, vi } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { eventInfo } from './event-info';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const EVENT_ID = '00000001-aaaa-4bbb-8ccc-000000000001';

const eventRow = {
  id: EVENT_ID,
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  timezone: 'Europe/Paris',
  city: 'Lyon',
  country: 'FR',
  organization_id: '00000003-aaaa-4bbb-8ccc-000000000003',
  event_kind: 'real',
};

function depsFor(event: unknown, listTournaments = vi.fn().mockResolvedValue([])) {
  const maybeSingle = () => Promise.resolve({ data: event, error: null });
  const chain = { select: () => chain, eq: () => chain, maybeSingle };
  return {
    deps: { supabase: { service: { from: () => chain } }, orgs: {}, events: { listTournaments } },
    listTournaments,
  } as never as { deps: never; listTournaments: typeof listTournaments };
}

describe('event_info', () => {
  it('answers the Event and its visible Tournaments, with no id at any depth', async () => {
    const listTournaments = vi.fn().mockResolvedValue([
      {
        id: '00000002-aaaa-4bbb-8ccc-000000000002',
        name: 'Longsword',
        slug: 'longsword',
        weapon: 'longsword',
        status: 'published',
        color: 'red',
        registered: 12,
      },
    ]);
    const d = depsFor(eventRow, listTournaments);
    const result = await eventInfo('fal-2026', caller, d.deps);
    // The reader is the connector's person, with no staff session.
    expect(listTournaments).toHaveBeenCalledWith(EVENT_ID, { userId: 'user-1', staff: null });
    expect(result).toEqual({
      name: 'FAL 2026',
      slug: 'fal-2026',
      startDate: '2026-03-14',
      endDate: '2026-03-15',
      status: 'published',
      timezone: 'Europe/Paris',
      city: 'Lyon',
      country: 'FR',
      tournaments: [
        { name: 'Longsword', slug: 'longsword', weapon: 'longsword', status: 'published' },
      ],
    });
    expectNoRawIds(result);
  });

  it('refuses an Event the caller cannot read as unknown', async () => {
    const d = depsFor(null);
    expect(await eventInfo('nope', caller, d.deps)).toEqual({
      refusal: 'No Event "nope" that you can see.',
    });
    expect(d.listTournaments).not.toHaveBeenCalled();
  });
});
