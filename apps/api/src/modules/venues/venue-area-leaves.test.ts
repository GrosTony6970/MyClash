import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import { withAreaLeaves, type AreaLeaves } from './venue-area-leaves';
import { VenuesService } from './venues.service';

/**
 * O25 (ruled 2026-10-14): removing a venue area asks first, naming the pistes and sessions it
 * leaves without an area. The club's venue list carries them, per area.
 */
const ok = (data: unknown) => ({ data, error: null });
const VENUES = [
  {
    id: 'v-1',
    name: 'Gymnase',
    venue_areas: [
      { id: 'a-1', name: 'Hall A', sort_order: 0 },
      { id: 'a-2', name: 'Hall B', sort_order: 1 },
    ],
  },
];

function run(seed: Record<string, unknown>, venues: Record<string, unknown>[] = VENUES) {
  const db = mockSupabase(seed as never);
  return { db, done: withAreaLeaves(db.service as unknown as SupabaseService['service'], venues) };
}

describe('withAreaLeaves', () => {
  it('names, per area, each Event piste and workshop session it holds', async () => {
    const { db, done } = run({
      lices: ok([{ area_id: 'a-1', name: 'Piste 1', event_id: 'e-1' }]),
      workshop_sessions: ok([
        {
          area_id: 'a-1',
          starts_at: '2027-05-01T09:00:00Z',
          workshops: { title: 'Dague', event_id: 'e-1' },
        },
      ]),
      events: ok([{ id: 'e-1', name: 'Open 2027' }]),
    });
    const [venue] = await done;
    expect(venue?.['venue_areas']).toEqual([
      {
        id: 'a-1',
        name: 'Hall A',
        sort_order: 0,
        leaves: {
          pistes: [{ name: 'Piste 1', event: 'Open 2027' }],
          sessions: [{ title: 'Dague', startsAt: '2027-05-01T09:00:00Z', event: 'Open 2027' }],
        },
      },
      { id: 'a-2', name: 'Hall B', sort_order: 1, leaves: { pistes: [], sessions: [] } },
    ]);
    expect(selectsFor(db.from, 'lices')).toEqual(['area_id, name, event_id']);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual([
      'area_id, starts_at, workshops!inner(title, event_id)',
    ]);
    expect(selectsFor(db.from, 'events')).toEqual(['id, name']);
    expect(filtersFor(db.from, 'lices', 'in')).toEqual([['area_id', ['a-1', 'a-2']]]);
    expect(filtersFor(db.from, 'workshop_sessions', 'in')).toEqual([['area_id', ['a-1', 'a-2']]]);
    expect(filtersFor(db.from, 'events', 'in')).toEqual([['id', ['e-1']]]);
  });

  it('is what the club’s venue list hands the venue window', async () => {
    const db = mockSupabase({
      venues: ok(VENUES),
      lices: ok([{ area_id: 'a-2', name: 'Piste 4', event_id: null, venue_id: null }]),
      workshop_sessions: ok([]),
      event_venues: ok([]),
    } as never);
    const service = new VenuesService(
      db as never,
      { assertOrgRole: async () => undefined } as never,
    );
    const [venue] = (await service.listForOrgMember('org-1', 'u-1')) as Record<string, unknown>[];
    const areas = venue?.['venue_areas'] as Array<{ leaves: AreaLeaves }>;
    expect(areas.map((area) => area.leaves.pistes)).toEqual([
      [],
      [{ name: 'Piste 4', event: null }],
    ]);
  });

  it('reads nothing for venues with no area', async () => {
    const { db, done } = run({}, [{ id: 'v-1', venue_areas: [] }]);
    await done;
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('throws a failed read: an area must never look empty for want of a read', async () => {
    await expect(run({ lices: { data: null, error: { message: 'down' } } }).done).rejects.toThrow(
      'The pistes of the areas could not be read: down',
    );
    await expect(
      run({ lices: ok([]), workshop_sessions: { data: null, error: { message: 'down' } } }).done,
    ).rejects.toThrow('The sessions of the areas could not be read: down');
  });
});
