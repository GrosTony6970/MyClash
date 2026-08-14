import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LiveStateService } from './live-state.service';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';

/**
 * The mock dispatches on TABLE NAME rather than on call order. live-state
 * issues `events` + `lices` inside one Promise.all and then
 * `event_programme_blocks` and `matches`, so an ordered
 * `mockReturnValueOnce` sequence desyncs the moment the service reorders
 * two awaits that have nothing to do with the assertion.
 */
const tables: Record<string, unknown> = {};

function makeChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<string, unknown> &
    Promise<unknown>;
  for (const key of ['select', 'eq', 'in', 'order', 'maybeSingle', 'limit', 'not']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  // maybeSingle terminates a chain, so it must resolve rather than chain.
  chain['maybeSingle'] = vi.fn().mockReturnValue(Promise.resolve(result));
  return chain;
}

const fromMock = vi.fn((table: string) => makeChain(tables[table] ?? { data: [], error: null }));
const supabase = { service: { from: fromMock } };
/** Refuses everyone, like `assertOrgRole` refuses a non-member. */
const orgs = { assertOrgRole: vi.fn(() => Promise.reject(new ForbiddenException('no'))) };
/** No cookie, no bearer — the caller resolves to the anonymous sentinel. */
const ANON = () => Promise.resolve(ANONYMOUS_USER_ID);

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const LICE_ID = '22222222-2222-4222-8222-222222222222';

function match(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'm-1',
    status: 'scheduled',
    scheduled_at: null,
    match_number_label: 'M-1',
    lice_id: LICE_ID,
    red_score: 0,
    blue_score: 0,
    red: null,
    blue: null,
    phases: null,
    ...over,
  };
}

function service() {
  return new LiveStateService(supabase as never, orgs as never);
}

beforeEach(() => {
  fromMock.mockClear();
  for (const key of Object.keys(tables)) delete tables[key];
  tables['events'] = {
    // `status` + `organization_id` ride along on the read the service already
    // does; the gate consumes them without a second round-trip.
    data: {
      start_date: new Date().toISOString(),
      status: 'published',
      organization_id: 'org-1',
    },
    error: null,
  };
  tables['lices'] = { data: [{ id: LICE_ID, name: 'Piste 1', sort_order: 0 }], error: null };
  tables['event_programme_blocks'] = { data: [], error: null };
});

describe('LiveStateService — a paused bout still holds its piste', () => {
  it('reports a paused match as the running match, never as the next one', async () => {
    tables['matches'] = {
      data: [match({ id: 'm-paused', status: 'paused', match_number_label: 'M-42' })],
      error: null,
    };

    const state = await service().getLiveState(EVENT_ID, ANON);

    // The regression: `status in ('running','scheduled')` dropped paused
    // bouts from the payload entirely, so a referee calling a halt made
    // the piste blink off the spectator boards mid-fight.
    expect(state.lices[0]?.runningMatch?.id).toBe('m-paused');
    expect(state.lices[0]?.runningMatch?.status).toBe('paused');
    expect(state.lices[0]?.nextMatch).toBeNull();
  });

  it('prefers a genuinely running bout when a piste carries both', async () => {
    tables['matches'] = {
      data: [
        match({ id: 'm-stale', status: 'paused' }),
        match({ id: 'm-live', status: 'running' }),
      ],
      error: null,
    };

    const state = await service().getLiveState(EVENT_ID, ANON);

    expect(state.lices[0]?.runningMatch?.id).toBe('m-live');
  });

  it('leaves a merely scheduled bout out of the running slot', async () => {
    tables['matches'] = { data: [match({ id: 'm-later', status: 'scheduled' })], error: null };

    const state = await service().getLiveState(EVENT_ID, ANON);

    expect(state.lices[0]?.runningMatch).toBeNull();
    expect(state.lices[0]?.nextMatch?.id).toBe('m-later');
  });
});

/**
 * This endpoint feeds the venue's hall display and the spectator app. Every
 * read used to drop `error`, so a refused query became an empty result and the
 * board confidently rendered every piste as idle — with a 200. An outage it
 * reports beats an outage it hides.
 */
describe('LiveStateService — a refused read is not an empty one', () => {
  it('does not report every piste idle when the matches read fails', async () => {
    tables['matches'] = { data: null, error: { message: 'connection reset' } };

    await expect(service().getLiveState(EVENT_ID, ANON)).rejects.toThrow(/matches read failed/);
  });

  it('fails loudly when the lices read fails, rather than answering with no pistes', async () => {
    tables['lices'] = { data: null, error: { message: 'permission denied' } };

    await expect(service().getLiveState(EVENT_ID, ANON)).rejects.toThrow(/lices read failed/);
  });

  it('fails loudly when the event read fails, rather than resolving the wrong day', async () => {
    tables['events'] = { data: null, error: { message: 'timeout' } };

    await expect(service().getLiveState(EVENT_ID, ANON)).rejects.toThrow(/event read failed/);
  });

  it('fails loudly when the programme-block read fails', async () => {
    tables['event_programme_blocks'] = { data: null, error: { message: 'timeout' } };

    await expect(service().getLiveState(EVENT_ID, ANON)).rejects.toThrow(
      /programme blocks read failed/,
    );
  });

  // `maybeSingle` raises PGRST116 when a slug matches more than one row, which
  // `events` allows: the UNIQUE is per organisation, not global. Swallowing the
  // error turned that into "Event not found" for an event that exists.
  it('distinguishes a failed slug lookup from a missing event', async () => {
    tables['events'] = { data: null, error: { message: 'PGRST116: multiple rows returned' } };

    await expect(service().getLiveState('open-2026', ANON)).rejects.toThrow(
      /event slug read failed/,
    );
  });

  it('still reports a genuinely missing event as not found', async () => {
    tables['events'] = { data: null, error: null };

    await expect(service().getLiveState('no-such-event', ANON)).rejects.toThrow(/Event not found/);
  });

  /**
   * The board names every fighter currently on a piste, and this route is
   * @Public() and polled from the venue. Public was unconditional: an event
   * still being built published its live board to anyone with the id.
   */
  describe('unannounced events', () => {
    function withStatus(status: string) {
      tables['events'] = {
        data: {
          start_date: new Date().toISOString(),
          status,
          organization_id: 'org-1',
        },
        error: null,
      };
    }

    it('404s an anonymous read of a draft event', async () => {
      withStatus('draft');
      await expect(service().getLiveState(EVENT_ID, ANON)).rejects.toThrow(NotFoundException);
    });

    it('serves a published event without ever resolving an identity', async () => {
      withStatus('published');
      const caller = vi.fn(() => Promise.resolve(ANONYMOUS_USER_ID));

      await expect(service().getLiveState(EVENT_ID, caller)).resolves.toBeDefined();
      // This route is polled continuously from the venue; resolving an identity
      // here would put a GoTrue round-trip on every poll.
      expect(caller).not.toHaveBeenCalled();
    });

    /** Archived stays readable on purpose — archiving locks writes, not reads. */
    it('serves an archived event', async () => {
      withStatus('archived');
      await expect(service().getLiveState(EVENT_ID, ANON)).resolves.toBeDefined();
    });

    it('costs no extra query — the gate reads the row the board already fetched', async () => {
      withStatus('published');
      await service().getLiveState(EVENT_ID, ANON);

      expect(fromMock.mock.calls.filter(([t]) => t === 'events')).toHaveLength(1);
    });
  });
});
