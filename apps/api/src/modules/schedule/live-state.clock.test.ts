import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { LiveStateService } from './live-state.service';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const LICE_ID = '22222222-2222-4222-8222-222222222222';
/** The same caller as the AuthGuard resolves it: no login, no staff session. */
const NO_ONE = { userId: ANONYMOUS_USER_ID, staff: null };

const bar = (id: string, day: number, sort: number, label: string, from: string, to: string) => ({
  id,
  event_id: EVENT_ID,
  day_index: day,
  sort_order: sort,
  block_type: 'competition',
  label,
  lice_count: 1,
  start_time: `${from}:00`,
  end_time: `${to}:00`,
});
const NEW_YORK_BARS = [
  bar('pools', 0, 0, 'Pools', '09:00', '12:00'),
  bar('finals', 0, 1, 'Finals', '19:00', '21:00'),
  bar('day2', 1, 0, 'Day 2 pools', '09:00', '12:00'),
];

function boardAt(nowIso: string, timezone: unknown, bars = NEW_YORK_BARS, firstDay = '2026-11-07') {
  vi.setSystemTime(new Date(nowIso));
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT_ID,
          start_date: firstDay,
          timezone,
          status: 'published',
          organization_id: 'org-1',
        },
      ],
    },
    lices: { rows: [{ id: LICE_ID, event_id: EVENT_ID, name: 'Piste 1', sort_order: 0 }] },
    event_programme_blocks: { rows: bars },
    matches: { rows: [] },
  });
  const live = new LiveStateService(db as never, new OrganizationsService(db as never));
  return live.getLiveState(EVENT_ID, NO_ONE);
}
const labels = (state: Awaited<ReturnType<typeof boardAt>>) => ({
  current: state.currentBlock?.label ?? null,
  next: state.nextBlock?.label ?? null,
});

/**
 * The board picks its bar by the Event's wall clock and calendar day (ruling 411), not the
 * server's: prod runs `TZ=Europe/Paris`, so only a non-Paris Event shows the difference.
 */
describe("LiveStateService — the board reads the Event's clock", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it('shows the bar of 10:00 in New York at 10:00 in New York', async () => {
    const state = await boardAt('2026-11-07T15:00:00Z', 'America/New_York');
    expect(labels(state)).toEqual({ current: 'Pools', next: 'Finals' });
    expect(state.timezone).toBe('America/New_York');
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps today's programme at 20:00 in New York, after midnight UTC", async () => {
    const state = await boardAt('2026-11-08T01:00:00Z', 'America/New_York');
    expect(labels(state)).toEqual({ current: 'Finals', next: null });
  });

  it("reads day 2's programme at 01:00 in Tokyo, while UTC is still on day 1", async () => {
    const state = await boardAt('2026-11-07T16:00:00Z', 'Asia/Tokyo');
    expect(labels(state)).toEqual({ current: null, next: 'Day 2 pools' });
    expect(state.timezone).toBe('Asia/Tokyo');
  });

  it.each([['Mars/Olympus'], [null]])(
    'reads an unknown zone %j on the Paris clock, says so, and answers Paris',
    async (timezone) => {
      // 08:30 UTC is 09:30 in Paris (CET): only the Paris clock is inside "Hour".
      const hour = [bar('hour', 0, 0, 'Hour', '09:00', '10:00')];
      const state = await boardAt('2026-11-07T08:30:00Z', timezone, hour);
      expect(labels(state)).toEqual({ current: 'Hour', next: null });
      expect(state.timezone).toBe('Europe/Paris');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe(
        `Event ${EVENT_ID}: unknown time zone ${JSON.stringify(timezone)}; days read in Europe/Paris`,
      );
    },
  );

  it('shows day 0 for a first day that is not a date, and says so', async () => {
    // 10:00 New York on the second day: a readable first day would show day 1's bars.
    const state = await boardAt('2026-11-08T15:00:00Z', 'America/New_York', NEW_YORK_BARS, '7 Nov');
    expect(labels(state)).toEqual({ current: 'Pools', next: 'Finals' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      `Event ${EVENT_ID}: first day "7 Nov" is not a date; the board shows day 0`,
    );
  });
});
