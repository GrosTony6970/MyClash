import { describe, expect, it } from 'vitest';
import type { HttpException } from '@nestjs/common';
import {
  filtersFor,
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { freeAt, FreeNowService, ownFreeUntil } from './free-now.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const OTHER_EVENT = 'eeeeeeee-0000-4000-8000-00000000000b';
const DRAFT_EVENT = 'eeeeeeee-0000-4000-8000-00000000000c';
const OFF_DAYS = 'eeeeeeee-0000-4000-8000-00000000000d';
const NOT_MINE = 'eeeeeeee-0000-4000-8000-00000000000e';

// Saturday and Sunday 2026-05-23/24 in New York (UTC-4 in May).
const event = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
  start_date: '2026-05-23',
  end_date: '2026-05-24',
  timezone: 'America/New_York',
  ...over,
});
const roster = (eventId: string, globalPersonId: string) => ({
  id: `p-${eventId}-${globalPersonId}`,
  event_id: eventId,
  global_person_id: globalPersonId,
});

function service() {
  const supabase = mockSupabase({
    events: {
      rows: [
        event(EVENT),
        event(OTHER_EVENT),
        event(DRAFT_EVENT, { status: 'draft' }),
        event(OFF_DAYS, { start_date: '2026-06-20', end_date: '2026-06-21' }),
        event(NOT_MINE),
      ],
    },
    persons: {
      rows: [
        roster(EVENT, MARC),
        roster(DRAFT_EVENT, MARC),
        roster(OFF_DAYS, MARC),
        roster(NOT_MINE, JULIE),
      ],
    },
    fightbook_free_now: { rows: [] },
  });
  return { free: new FreeNowService(supabase as never), supabase };
}

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return [error.getStatus(), (error.getResponse() as { code?: string }).code];
}

// The Event clock is read from the Event's own zone, never the machine's. `luxon` is not an API
// dependency, so its default zone cannot be pinned here; the suite is run under TZ=UTC and
// TZ=Pacific/Auckland instead (task 4 report).

describe('FreeNowService.switchOn', () => {
  it('lasts an hour', async () => {
    const { free, supabase } = service();
    // Saturday 14:00 in New York.
    const now = new Date('2026-05-23T18:00:00Z');
    expect(await free.switchOn(MARC, EVENT, now)).toEqual({ until: '2026-05-23T19:00:00.000Z' });
    const [write] = writesTo(supabase, 'fightbook_free_now');
    expect(write?.op).toBe('upsert');
    expect(write?.row).toEqual({
      global_person_id: MARC,
      event_id: EVENT,
      until: '2026-05-23T19:00:00.000Z',
    });
  });

  it('at 05:30 mid-Event lasts to 06:30: the new day is today', async () => {
    const { free } = service();
    const now = new Date('2026-05-24T09:30:00Z'); // Sunday 05:30 in New York
    expect(await free.switchOn(MARC, EVENT, now)).toEqual({ until: '2026-05-24T10:30:00.000Z' });
  });

  it('on the morning after the last day stops at 06:00', async () => {
    const { free } = service();
    const now = new Date('2026-05-25T09:30:00Z'); // Monday 05:30 in New York
    expect(await free.switchOn(MARC, EVENT, now)).toEqual({ until: '2026-05-25T10:00:00.000Z' });
  });

  it('upserts on the profile, so a fighter is free at one Event at a time', async () => {
    const { free, supabase } = service();
    await free.switchOn(MARC, EVENT, new Date('2026-05-23T18:00:00Z'));
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, status, organization_id, event_kind, start_date, end_date, timezone',
    ]);
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
    expect(filtersFor(supabase.from, 'persons', 'eq')).toEqual([
      ['event_id', EVENT],
      ['global_person_id', MARC],
    ]);
  });

  it.each([
    ['a draft Event', DRAFT_EVENT],
    ['an Event I am not on', NOT_MINE],
    ['an unknown Event', 'eeeeeeee-0000-4000-8000-0000000000ff'],
    ['an Event that has not started', OFF_DAYS],
  ])('refuses %s: bad_event, and writes nothing', async (_, id) => {
    const { free, supabase } = service();
    const now = new Date('2026-05-23T18:00:00Z');
    expect(await codeOf(free.switchOn(MARC, id, now))).toEqual([400, 'bad_event']);
    expect(writesTo(supabase, 'fightbook_free_now')).toEqual([]);
  });

  it('refuses an Event whose days have all ended', async () => {
    const { free } = service();
    const now = new Date('2026-05-25T10:30:00Z'); // after Monday 06:00 in New York
    expect(await codeOf(free.switchOn(MARC, EVENT, now))).toEqual([400, 'bad_event']);
  });
});

describe('FreeNowService.switchOff', () => {
  it("deletes the caller's row for that Event, and no one else's", async () => {
    const { free, supabase } = service();
    await free.switchOff(MARC, EVENT);
    const [write] = writesTo(supabase, 'fightbook_free_now');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'global_person_id')).toBe(MARC);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
  });

  it('is quiet when there is nothing to delete (two taps)', async () => {
    const { free } = service();
    await expect(free.switchOff(MARC, EVENT)).resolves.toBeUndefined();
  });
});

describe('freeAt', () => {
  const NOW = new Date('2026-05-23T18:00:00Z');
  const row = (gp: string, eventId: string, until: string) => ({
    global_person_id: gp,
    event_id: eventId,
    until,
  });

  it('names the listed fighters free here and now, not another Event, not one past its time', async () => {
    const supabase = mockSupabase({
      fightbook_free_now: {
        rows: [
          row(JULIE, EVENT, '2026-05-23T18:30:00.000Z'),
          row(PAUL, OTHER_EVENT, '2026-05-23T18:30:00.000Z'),
          row(MARC, EVENT, '2026-05-23T17:59:00.000Z'),
        ],
      },
    });
    const free = await freeAt(supabase as never, EVENT, [JULIE, PAUL, MARC], NOW);
    expect([...free]).toEqual([JULIE]);
    expect(selectsFor(supabase.from, 'fightbook_free_now')).toEqual(['global_person_id']);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'gt')).toEqual([
      ['until', NOW.toISOString()],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'in')).toEqual([
      ['global_person_id', [JULIE, PAUL, MARC]],
    ]);
  });

  it('reads nothing for no one', async () => {
    const supabase = mockSupabase({ fightbook_free_now: { rows: [] } });
    expect([...(await freeAt(supabase as never, EVENT, [], NOW))]).toEqual([]);
    expect(selectsFor(supabase.from, 'fightbook_free_now')).toEqual([]);
  });
});

describe('ownFreeUntil', () => {
  const NOW = new Date('2026-05-23T18:00:00Z');

  it("is the caller's own live time, per Event; a past one or another's reads null", async () => {
    const supabase = mockSupabase({
      fightbook_free_now: {
        rows: [
          { global_person_id: MARC, event_id: EVENT, until: '2026-05-23T18:30:00.000Z' },
          { global_person_id: JULIE, event_id: OTHER_EVENT, until: '2026-05-23T18:40:00.000Z' },
        ],
      },
    });
    const own = await ownFreeUntil(supabase as never, MARC, NOW);
    expect(own.get(EVENT)).toBe('2026-05-23T18:30:00.000Z');
    expect(own.get(OTHER_EVENT)).toBeUndefined();
    expect(selectsFor(supabase.from, 'fightbook_free_now')).toEqual(['event_id, until']);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'eq')).toEqual([
      ['global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'gt')).toEqual([
      ['until', NOW.toISOString()],
    ]);
  });

  it('reads null for a time already past', async () => {
    const supabase = mockSupabase({
      fightbook_free_now: {
        rows: [{ global_person_id: MARC, event_id: EVENT, until: '2026-05-23T17:00:00.000Z' }],
      },
    });
    expect((await ownFreeUntil(supabase as never, MARC, NOW)).size).toBe(0);
  });
});
