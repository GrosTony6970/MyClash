import { describe, expect, it, vi } from 'vitest';
import { MeEventsService } from './me-events.service';

/**
 * Referee duties on the /me event hub are a "what do I do next" list, so they
 * must come back chronologically — `referee_assignments` has no natural order
 * and previously reached the UI in Postgres heap order. Same thenable-chain
 * mock as me-events.list.test, plus per-table chain capture so the ORDER BY
 * itself can be asserted.
 */
type Chain = Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
function q(result: unknown): Chain {
  const promise = Promise.resolve(result) as Chain;
  for (const m of ['select', 'eq', 'in', 'neq', 'order', 'or', 'not', 'maybeSingle']) {
    promise[m] = vi.fn(() => promise);
  }
  return promise;
}

const EVENT = {
  id: 'e-1',
  slug: 'fosse-2027',
  name: 'Fosse aux Lions 2027',
  start_date: '2027-05-22',
  end_date: '2027-05-23',
  status: 'published',
  timezone: 'Europe/Paris',
  event_kind: 'standard',
};

/** A referee_assignments row as PostgREST returns it (embeds flattened away). */
const ASSIGNMENT = (id: string, startsAt: string | null) => ({
  id,
  role: 'referee_table',
  starts_at: startsAt,
  ends_at: null,
  pool_id: null,
  events: EVENT,
  pools: null,
  matches: null,
  lices: null,
});

function buildService(assignments: unknown[]) {
  const chains = new Map<string, Chain>();
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        const chain =
          table === 'referee_assignments'
            ? q({ data: assignments, error: null })
            : table === 'global_persons'
              ? q({ data: { id: 'gp-1' }, error: null })
              : q({ data: [], error: null });
        if (!chains.has(table)) chains.set(table, chain);
        return chain;
      }),
    },
  };
  return { service: new MeEventsService(supabase as never, {} as never), chains };
}

describe('MeEventsService.listMyEvents — referee duty ordering', () => {
  it('asks Postgres for the duties in start order, undated last', async () => {
    const { service, chains } = buildService([ASSIGNMENT('a-1', '2027-05-22T13:00:00Z')]);
    await service.listMyEvents('user-1');
    expect(chains.get('referee_assignments')!.order).toHaveBeenCalledWith('starts_at', {
      ascending: true,
      nullsFirst: false,
    });
  });

  it('exposes the assignment id so the UI has a stable key per duty', async () => {
    const { service } = buildService([
      ASSIGNMENT('a-1', '2027-05-22T13:00:00Z'),
      ASSIGNMENT('a-2', null),
    ]);
    const events = await service.listMyEvents('user-1');
    expect(events[0]!.refereeOf.map((r) => r.id)).toEqual(['a-1', 'a-2']);
  });

  it('preserves the order the query returned (no re-shuffle while enriching)', async () => {
    const { service } = buildService([
      ASSIGNMENT('pool', '2027-05-22T13:00:00Z'),
      ASSIGNMENT('qf-early', '2027-05-23T09:11:00Z'),
      ASSIGNMENT('qf-late', '2027-05-23T13:21:00Z'),
    ]);
    const events = await service.listMyEvents('user-1');
    expect(events[0]!.refereeOf.map((r) => r.startsAt)).toEqual([
      '2027-05-22T13:00:00Z',
      '2027-05-23T09:11:00Z',
      '2027-05-23T13:21:00Z',
    ]);
  });
});
