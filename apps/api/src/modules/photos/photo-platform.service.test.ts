import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import { PhotoPlatformService } from './photo-platform.service';

/** The platform's Photos page (ruling 493): which Events, in what order, with what numbers. */

const EVENT_COLUMNS =
  'id, organization_id, slug, name, start_date, end_date, timezone, photo_mode, photo_token_version';

function eventRow(n: number, over: Partial<SupabaseRow> = {}): SupabaseRow {
  return {
    id: `ev-${String(n).padStart(3, '0')}`,
    organization_id: 'org-1',
    slug: `open-${n}`,
    name: `Open ${n}`,
    start_date: `2026-${String((n % 12) + 1).padStart(2, '0')}-01`,
    end_date: null,
    timezone: 'Europe/Paris',
    photo_mode: 'approve',
    photo_token_version: 1,
    ...over,
  };
}

function platform(options: {
  events: SupabaseRow[];
  holding?: string[];
  clubs?: SupabaseRow[];
  eventsFail?: boolean;
  rpcFails?: boolean;
}) {
  const supabase = mockSupabase(
    {
      events: options.eventsFail
        ? { data: null, error: { message: 'events down' } }
        : { rows: options.events },
      organizations: { rows: options.clubs ?? [{ id: 'org-1', name: 'Lyon AMHE' }] },
    },
    {
      event_photo_events: () =>
        options.rpcFails
          ? { data: null, error: { message: 'rpc down' } }
          : { data: (options.holding ?? []).map((event_id) => ({ event_id })), error: null },
    },
  );
  let running = 0;
  let most = 0;
  const moderation = {
    counts: vi.fn(async (event: { id: string }) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return { waiting: event.id.length, reported: 1 };
    }),
  };
  const service = new PhotoPlatformService(supabase as never, moderation as never);
  return { service, supabase, moderation, most: () => most };
}

afterEach(() => vi.restoreAllMocks());

describe('the platform Photos list', () => {
  it('lists the Events taking photos and the Off ones still holding some; an Off one with none is left out', async () => {
    const on = eventRow(1);
    const offHolding = eventRow(2, { photo_mode: 'off' });
    const offEmpty = eventRow(3, { photo_mode: 'off' });
    const { service } = platform({ events: [on, offHolding, offEmpty], holding: ['ev-002'] });
    const ids = (await service.events()).map((row) => row.id);
    expect(ids.sort()).toEqual(['ev-001', 'ev-002']);
  });

  it('puts the newest first, an Event with no date last, ties by id', async () => {
    // Seeded against the expected order, so neither the date nor the tie-break holds by luck.
    const events = [
      eventRow(4, { start_date: '2026-03-01' }),
      eventRow(2, { start_date: null }),
      eventRow(1, { start_date: '2026-03-01' }),
      eventRow(3, { start_date: '2026-09-01' }),
    ];
    const { service } = platform({ events });
    expect((await service.events()).map((row) => row.id)).toEqual([
      'ev-003',
      'ev-001',
      'ev-004',
      'ev-002',
    ]);
  });

  it("gives each its club's name, its mode and the moderation counts, read on the gate's columns", async () => {
    const { service, supabase, moderation } = platform({
      events: [eventRow(1), eventRow(2, { organization_id: 'org-gone' })],
    });
    const rows = await service.events();
    expect(rows.find((row) => row.id === 'ev-001')).toEqual({
      id: 'ev-001',
      name: 'Open 1',
      clubName: 'Lyon AMHE',
      startDate: '2026-02-01',
      endDate: null,
      mode: 'approve',
      waiting: 6,
      reported: 1,
    });
    expect(rows.find((row) => row.id === 'ev-002')?.clubName).toBeNull();
    expect(moderation.counts).toHaveBeenCalledWith(expect.objectContaining(eventRow(1)));
    expect(selectsFor(supabase.from, 'events')).toEqual(['id', EVENT_COLUMNS]);
    expect(selectsFor(supabase.from, 'organizations')).toEqual(['id, name']);
  });

  it('lists at most 200 Events, and counts at most 8 at once', async () => {
    const events = Array.from({ length: 205 }, (_, n) => eventRow(n));
    const { service, most } = platform({ events });
    expect(await service.events()).toHaveLength(200);
    expect(most()).toBe(8);
  });

  it('a read cut at its cap keeps the newest Events and is logged, from either source', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // 1001 Events taking photos, the oldest seeded first: the cut must drop the oldest.
    const events = Array.from({ length: 1001 }, (_, n) =>
      eventRow(n, { start_date: `2026-01-01`, id: `ev-${String(n).padStart(4, '0')}` }),
    );
    events[0] = { ...events[0]!, start_date: '2020-01-01' };
    events[1000] = { ...events[1000]!, start_date: '2030-01-01' };
    const { service } = platform({ events });
    const ids = (await service.events()).map((row) => row.id);
    expect(ids[0]).toBe('ev-1000');
    expect(warn).toHaveBeenCalledWith('999 Events take photos: the list is cut');

    const holding = Array.from({ length: 1000 }, (_, n) => `held-${n}`);
    await platform({ events: [], holding }).service.events();
    expect(warn).toHaveBeenCalledWith('1000 Events hold photos: the list may be cut');
  });

  it('reads nothing more when no Event takes or holds photos', async () => {
    const { service, supabase } = platform({ events: [eventRow(1, { photo_mode: 'off' })] });
    expect(await service.events()).toEqual([]);
    expect(selectsFor(supabase.from, 'organizations')).toEqual([]);
  });

  it('an unknown mode reads as Off and is logged; the list stays up', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = platform({ events: [eventRow(1, { photo_mode: 'sideways' })] });
    expect((await service.events())[0]?.mode).toBe('off');
    expect(warn).toHaveBeenCalledWith('Event ev-001: unknown photo mode sideways');
  });

  it('a failed read is a 5xx, never an empty list', async () => {
    await expect(platform({ events: [], eventsFail: true }).service.events()).rejects.toThrow(
      'events down',
    );
    await expect(
      platform({ events: [eventRow(1)], rpcFails: true }).service.events(),
    ).rejects.toThrow('rpc down');
  });
});
