import { describe, expect, it, vi } from 'vitest';
import { PublicScheduleService } from './public-schedule.service';

/**
 * Referee slots mix two shapes: match-scoped rows (display time = the match's
 * `scheduled_at`) and pool-/lice-scoped rows (display time = the assignment's
 * own `starts_at`). No single column orders that mix, so the service sorts on
 * `scheduledAt ?? startsAt` — the same key the schedule view uses.
 *
 * Thenable query chain: every builder method returns the same object, which
 * also resolves. Mirrors me-events.list.test.
 */
type Chain = Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
function q(result: unknown): Chain {
  const promise = Promise.resolve(result) as Chain;
  for (const m of ['select', 'eq', 'in', 'neq', 'order', 'or', 'not', 'maybeSingle']) {
    promise[m] = vi.fn(() => promise);
  }
  return promise;
}

const PHASE = {
  visibility_status: 'published',
  type: 'pool',
  config_json: null,
  tournaments: { name: 'Longsword Open', slug: 'longsword-open' },
};

/** A match-scoped assignment: the time lives on the embedded match. */
const matchScoped = (id: string, scheduledAt: string | null) => ({
  id,
  role: 'referee_table',
  starts_at: null,
  ends_at: null,
  pool_id: null,
  pools: null,
  lices: null,
  matches: {
    id: `m-${id}`,
    match_number_label: id,
    scheduled_at: scheduledAt,
    bracket_slot_id: null,
    pools: null,
    lices: null,
    phases: PHASE,
  },
});

/** A pool-scoped duty ("Déclarant"): no match, so the time is its own window. */
const poolScoped = (id: string, startsAt: string | null) => ({
  id,
  role: 'referee_declarant',
  starts_at: startsAt,
  ends_at: null,
  pool_id: null,
  pools: { id: 'pool-1', name: 'Pool 1', phases: PHASE },
  lices: null,
  matches: null,
});

function buildService(assignments: unknown[], timezone: string | null = null) {
  const chains = new Map<string, Chain>();
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        const chain =
          table === 'referee_assignments'
            ? q({ data: assignments, error: null })
            : table === 'persons'
              ? q({ data: { global_person_id: 'gp-1' }, error: null })
              : table === 'events'
                ? q({ data: timezone === null ? null : { timezone }, error: null })
                : q({ data: [], error: null });
        if (!chains.has(table)) chains.set(table, chain);
        return chain;
      }),
    },
  };
  const privacy = { canSeeWorkshops: vi.fn(async () => false) };
  return {
    service: new PublicScheduleService(supabase as never, privacy as never),
    chains,
  };
}

describe('PublicScheduleService.getSchedule — referee slot ordering', () => {
  it('orders match-scoped and pool-scoped duties together on their display time', async () => {
    const { service } = buildService([
      matchScoped('qf-late', '2027-05-23T13:21:00Z'),
      poolScoped('pool-sat', '2027-05-22T13:00:00Z'),
      matchScoped('qf-early', '2027-05-23T09:11:00Z'),
    ]);
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['pool-sat', 'qf-early', 'qf-late']);
  });

  it('puts undated duties last', async () => {
    const { service } = buildService([
      poolScoped('tbd', null),
      matchScoped('dated', '2027-05-23T09:00:00Z'),
    ]);
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['dated', 'tbd']);
  });

  it('exposes the assignment id — matchId is empty for every pool-scoped duty', async () => {
    const { service } = buildService([poolScoped('a-1', null), poolScoped('a-2', null)]);
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.matchId)).toEqual(['', '']);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['a-1', 'a-2']);
  });

  /**
   * Every instant in this payload is UTC and the client groups them into days,
   * which is only correct on the event's clock. Without the zone the client fell
   * back to the UTC day, so a fighter at an event west of UTC saw an afternoon
   * bout filed under tomorrow.
   */
  it('carries the event timezone, so the client can group by the event day', async () => {
    const { service, chains } = buildService([], 'America/Los_Angeles');
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.timezone).toBe('America/Los_Angeles');
    // Assert the projection, not only the value: this mock ignores the select
    // string, so dropping `timezone` from the read leaves the fallback in place
    // and a value-only assertion would still pass on Europe/Paris.
    expect(chains.get('events')!.select).toHaveBeenCalledWith('timezone');
  });

  it('falls back to the platform default when the event row is unreadable', async () => {
    // `events.timezone` is NOT NULL DEFAULT (migration 0102), so this only fires
    // on an unreadable row — where a wrong day heading beats an empty schedule.
    const { service } = buildService([], null);
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.timezone).toBe('Europe/Paris');
  });

  it('asks Postgres for a deterministic base order', async () => {
    const { service, chains } = buildService([poolScoped('a-1', '2027-05-22T13:00:00Z')]);
    await service.getSchedule('e-1', 'p-1', null);
    expect(chains.get('referee_assignments')!.order).toHaveBeenCalledWith('starts_at', {
      ascending: true,
      nullsFirst: false,
    });
  });
});
