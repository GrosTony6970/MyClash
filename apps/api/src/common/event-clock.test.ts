import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { barDay, barInstant, eventZone, readEventClock } from './event-clock';
import { mockSupabase, selectsFor, type TableSeed } from './testing/supabase-chain';

describe('eventZone', () => {
  it('keeps an IANA zone', () => {
    expect(eventZone('America/New_York')).toEqual({ zone: 'America/New_York', unknownZone: false });
  });

  // Luxon reads the last three as the SERVER's zone, which is the bug the guard exists to stop.
  for (const stored of ['Mars/Olympus', undefined, null, 'local']) {
    it(`reads ${JSON.stringify(stored)} as the default zone, and says so`, () => {
      expect(eventZone(stored)).toEqual({ zone: 'Europe/Paris', unknownZone: true });
    });
  }
});

describe('barDay', () => {
  it('counts calendar days from the first day', () => {
    expect(barDay('2026-11-07', 0)).toBe('2026-11-07');
    expect(barDay('2026-11-07', 2)).toBe('2026-11-09');
  });

  it('is null on a day that is not a date', () => {
    expect(barDay('2026-13-40', 0)).toBeNull();
  });
});

describe('barInstant', () => {
  it("reads 09:00 on the Event's own clock", () => {
    expect(barInstant('2026-11-07', 540, 'America/New_York')).toBe('2026-11-07T14:00:00.000Z');
    expect(barInstant('2026-11-07', 540, 'Europe/Paris')).toBe('2026-11-07T08:00:00.000Z');
    expect(barInstant('2026-11-07', 540, 'Asia/Tokyo')).toBe('2026-11-07T00:00:00.000Z');
  });

  it("puts a minute past midnight on the next day's clock", () => {
    // 1500 = 25:00, so 01:00 Paris on 11-08.
    expect(barInstant('2026-11-07', 1500, 'Europe/Paris')).toBe('2026-11-08T00:00:00.000Z');
  });

  it('is null on a negative minute', () => {
    expect(barInstant('2026-11-07', -30, 'Europe/Paris')).toBeNull();
  });
});

describe('readEventClock', () => {
  const EVENT = 'event-1';

  function read(seed: TableSeed) {
    const supabase = mockSupabase({ events: seed });
    const logger = { warn: vi.fn() };
    const run = () => readEventClock(supabase.service as unknown as SupabaseClient, EVENT, logger);
    return { supabase, logger, run };
  }

  const row = (over: Record<string, unknown>) => ({
    rows: [{ id: EVENT, start_date: '2026-11-07', timezone: 'America/New_York', ...over }],
  });

  it("returns the Event's first day and zone, and reads both columns", async () => {
    const { supabase, logger, run } = read(row({}));

    await expect(run()).resolves.toEqual({ firstDay: '2026-11-07', zone: 'America/New_York' });
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads an unknown zone as the default, and warns once naming the Event and the zone', async () => {
    const { logger, run } = read(row({ timezone: 'Mars/Olympus' }));

    await expect(run()).resolves.toEqual({ firstDay: '2026-11-07', zone: 'Europe/Paris' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = String(logger.warn.mock.calls[0]?.[0]);
    expect(message).toContain(EVENT);
    expect(message).toContain('"Mars/Olympus"');
  });

  it('is a 404 when there is no such Event', async () => {
    const { run } = read({ rows: [] });
    await expect(run()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a 400 when the read fails', async () => {
    const { run } = read({ data: null, error: { message: 'events exploded' } });
    await expect(run()).rejects.toThrow(BadRequestException);
    await expect(run()).rejects.toThrow('events exploded');
  });

  for (const startDate of ['next spring', null]) {
    it(`is a 400 quoting the first day when it is ${JSON.stringify(startDate)}`, async () => {
      const { run } = read(row({ start_date: startDate }));
      await expect(run()).rejects.toThrow(BadRequestException);
      await expect(run()).rejects.toThrow(String(startDate));
    });
  }
});
