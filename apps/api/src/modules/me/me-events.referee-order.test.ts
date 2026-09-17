import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDutyWindows } from '../schedule/duty-windows';
import { MeEventsService } from './me-events.service';

// The helper is a plain module with reads of its own, proven by its own test.
// Mocked here so this file holds what the service hands it and what it does
// with the answer.
vi.mock('../schedule/duty-windows', () => ({ resolveDutyWindows: vi.fn() }));
const dutyWindows = vi.mocked(resolveDutyWindows);

/**
 * Referee duties on the /me event hub are a "what do I do next" list, so they
 * must come back chronologically — `referee_assignments` has no natural order,
 * and a duty's time is worked out from its Matches, which SQL cannot order by.
 * Same thenable-chain mock as me-events.list.test, plus per-table chain capture
 * so the read itself can be asserted.
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
const ASSIGNMENT = (
  id: string,
  scope: { eventId?: string; poolId?: string | null; matchId?: string | null } = {},
) => ({
  id,
  role: 'referee_table',
  event_id: scope.eventId ?? 'e-1',
  pool_id: scope.poolId ?? null,
  match_id: scope.matchId ?? null,
  events: { ...EVENT, id: scope.eventId ?? 'e-1' },
  pools: null,
  matches: null,
  lices: null,
});

/** The helper's answer: a window for every duty, untimed unless listed. */
function windowsAre(times: Record<string, [string, string | null]>) {
  dutyWindows.mockImplementation(
    async (_db, _logger, duties) =>
      new Map(
        duties.map((duty) => {
          const [startsAt, endsAt] = times[duty.id] ?? [null, null];
          return [duty.id, { startsAt, endsAt }];
        }),
      ),
  );
}

function buildService(assignments: unknown) {
  const chains = new Map<string, Chain>();
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        const chain =
          table === 'referee_assignments'
            ? q(assignments)
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

const rows = (data: unknown[]) => ({ data, error: null });

afterEach(() => {
  vi.restoreAllMocks();
  dutyWindows.mockReset();
});

describe('MeEventsService.listMyEvents — referee duty times and order', () => {
  it('reads the duty scope and no stored time, and leaves the order to the service', async () => {
    windowsAre({});
    const { service, chains } = buildService(rows([ASSIGNMENT('a-1', { poolId: 'pool-1' })]));
    await service.listMyEvents('user-1');
    const read = chains.get('referee_assignments');
    // The double ignores the projection: without this, a stored column could
    // come back into the read and every value below would still be right.
    expect(
      String(read?.select?.mock.calls[0]?.[0] ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe(
      'id, role, event_id, pool_id, match_id, ' +
        'events ( id, slug, name, start_date, end_date, status, timezone, event_kind ), ' +
        'pools ( name, phases ( type, config_json, tournaments ( name ) ) ), ' +
        'matches ( bracket_slot_id, pools ( name, phases ( type, config_json, tournaments ( name ) ) ), ' +
        'phases ( type, config_json, tournaments ( name ) ), lices ( name, venues ( name ) ) ), ' +
        'lices ( name, venues ( name ) )',
    );
    expect(read?.order).not.toHaveBeenCalled();
  });

  it("hands the helper each duty's own Event and scope, and the service's logger", async () => {
    windowsAre({});
    const { service } = buildService(
      rows([
        ASSIGNMENT('pool-duty', { eventId: 'e-1', poolId: 'pool-1' }),
        ASSIGNMENT('bout-duty', { eventId: 'e-2', matchId: 'm-7' }),
      ]),
    );
    await service.listMyEvents('user-1');
    expect(dutyWindows).toHaveBeenCalledTimes(1);
    expect(dutyWindows.mock.calls[0]?.[1]).toBeInstanceOf(Logger);
    expect(dutyWindows.mock.calls[0]?.[2]).toEqual([
      { id: 'pool-duty', eventId: 'e-1', matchId: null, poolId: 'pool-1' },
      { id: 'bout-duty', eventId: 'e-2', matchId: 'm-7', poolId: null },
    ]);
  });

  it('asks for no time on a duty in an Event the list hides', async () => {
    windowsAre({});
    const hidden = { ...ASSIGNMENT('in-test-event', { eventId: 'e-test' }) };
    hidden.events = { ...hidden.events, event_kind: 'test' };
    const { service } = buildService(rows([hidden, ASSIGNMENT('shown', { poolId: 'pool-1' })]));
    await service.listMyEvents('user-1');
    expect(dutyWindows.mock.calls[0]?.[2]?.map((duty) => duty.id)).toEqual(['shown']);
  });

  it('exposes the assignment id so the UI has a stable key per duty', async () => {
    windowsAre({ 'a-1': ['2027-05-22T13:00:00.000Z', null] });
    const { service } = buildService(rows([ASSIGNMENT('a-1'), ASSIGNMENT('a-2')]));
    const events = await service.listMyEvents('user-1');
    expect(events[0]!.refereeOf.map((r) => r.id)).toEqual(['a-1', 'a-2']);
  });

  it('orders duties given in heap order by their computed start, undated last', async () => {
    windowsAre({
      'qf-late': ['2027-05-23T13:21:00.000Z', '2027-05-23T13:29:00.000Z'],
      pool: ['2027-05-22T13:00:00.000Z', '2027-05-22T14:05:00.000Z'],
      'qf-early': ['2027-05-23T09:11:00.000Z', null],
    });
    const { service } = buildService(
      rows([ASSIGNMENT('tbd'), ASSIGNMENT('qf-late'), ASSIGNMENT('pool'), ASSIGNMENT('qf-early')]),
    );
    const events = await service.listMyEvents('user-1');
    expect(events[0]!.refereeOf.map((r) => [r.id, r.startsAt, r.endsAt])).toEqual([
      ['pool', '2027-05-22T13:00:00.000Z', '2027-05-22T14:05:00.000Z'],
      ['qf-early', '2027-05-23T09:11:00.000Z', null],
      ['qf-late', '2027-05-23T13:21:00.000Z', '2027-05-23T13:29:00.000Z'],
      ['tbd', null, null],
    ]);
  });

  it('says so when the duties themselves cannot be read', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    windowsAre({});
    const { service } = buildService({ data: null, error: { message: 'column does not exist' } });
    expect(await service.listMyEvents('user-1')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('column does not exist');
  });
});
