import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveStateService } from './live-state.service';

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
  return new LiveStateService(supabase as never);
}

beforeEach(() => {
  fromMock.mockClear();
  for (const key of Object.keys(tables)) delete tables[key];
  tables['events'] = { data: { start_date: new Date().toISOString() }, error: null };
  tables['lices'] = { data: [{ id: LICE_ID, name: 'Piste 1', sort_order: 0 }], error: null };
  tables['event_programme_blocks'] = { data: [], error: null };
});

describe('LiveStateService — a paused bout still holds its piste', () => {
  it('reports a paused match as the running match, never as the next one', async () => {
    tables['matches'] = {
      data: [match({ id: 'm-paused', status: 'paused', match_number_label: 'M-42' })],
      error: null,
    };

    const state = await service().getLiveState(EVENT_ID);

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

    const state = await service().getLiveState(EVENT_ID);

    expect(state.lices[0]?.runningMatch?.id).toBe('m-live');
  });

  it('leaves a merely scheduled bout out of the running slot', async () => {
    tables['matches'] = { data: [match({ id: 'm-later', status: 'scheduled' })], error: null };

    const state = await service().getLiveState(EVENT_ID);

    expect(state.lices[0]?.runningMatch).toBeNull();
    expect(state.lices[0]?.nextMatch?.id).toBe('m-later');
  });
});
