import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  supabaseChain,
} from '../../common/testing/supabase-chain';
import { SparFindService } from './spar-find.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const ev = (n: number) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SOON = ev(1);
const SAME_B = ev(2);
const SAME_A = ev(3);
const OVER = ev(4);
const DRAFT = ev(5);
const TEST = ev(6);
const NOT_MINE = ev(7);
const NEW_YORK = ev(8);

const event = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
  start_date: '2026-05-23',
  end_date: '2026-05-24',
  timezone: 'Europe/Paris',
  ...over,
});
const roster = (id: string, eventId: string, globalPersonId: string) => ({
  id,
  event_id: eventId,
  global_person_id: globalPersonId,
});

// Sunday 2026-05-24, 05:59 in Paris: Saturday's day has one minute left.
const NOW = new Date('2026-05-24T03:59:00Z');

// Marc is free at Zeta Open until 06:30 Paris time, his row for Beta Cup ended at 05:58 (past
// at NOW), and Julie's row at Alpha Cup is not his.
const FREE_UNTIL = '2026-05-24T04:30:00.000Z';
const freeRows = [
  { global_person_id: MARC, event_id: SOON, until: FREE_UNTIL },
  { global_person_id: MARC, event_id: SAME_B, until: '2026-05-24T03:58:00.000Z' },
  { global_person_id: JULIE, event_id: SAME_A, until: FREE_UNTIL },
];

function service(rows = defaultEvents) {
  const supabase = mockSupabase({
    persons: {
      rows: [
        roster('p1', SOON, MARC),
        roster('p2', SAME_B, MARC),
        roster('p3', SAME_A, MARC),
        roster('p4', OVER, MARC),
        roster('p5', DRAFT, MARC),
        roster('p6', TEST, MARC),
        roster('p7', NEW_YORK, MARC),
        roster('p8', NOT_MINE, JULIE),
        roster('p9', SOON, JULIE),
      ],
    },
    events: { rows },
    fightbook_free_now: { rows: freeRows },
  });
  return { find: new SparFindService(supabase as never, {} as never), supabase };
}

const defaultEvents = [
  event(SOON, 'Zeta Open', { start_date: '2026-05-23' }),
  event(SAME_B, 'Beta Cup', { start_date: '2026-05-24', end_date: '2026-05-24' }),
  event(SAME_A, 'Alpha Cup', { start_date: '2026-05-24', end_date: '2026-05-24' }),
  // Its last day (Friday) ended at 06:00 yesterday, but the read's date bound still lets it in.
  event(OVER, 'Over Cup', { start_date: '2026-05-21', end_date: '2026-05-22' }),
  event(DRAFT, 'Draft Cup', { status: 'draft' }),
  event(TEST, 'Test Cup', { event_kind: 'test' }),
  event(NOT_MINE, 'Julie Only Cup'),
  event(NEW_YORK, 'Hudson Open', {
    timezone: 'America/New_York',
    start_date: '2026-05-23',
    end_date: '2026-05-23',
  }),
];

describe('SparFindService.myEvents', () => {
  it('lists the public Events I am on with open days, by first day then name', async () => {
    const { find } = service();
    const result = await find.myEvents(MARC, NOW);
    expect(result).toEqual([
      // New York is still Saturday evening: its only day started and is open.
      {
        id: NEW_YORK,
        name: 'Hudson Open',
        days: ['2026-05-23'],
        today: '2026-05-23',
        freeUntil: null,
      },
      {
        id: SOON,
        name: 'Zeta Open',
        days: ['2026-05-23', '2026-05-24'],
        today: '2026-05-24',
        freeUntil: '2026-05-24T04:30:00.000Z',
      },
      { id: SAME_A, name: 'Alpha Cup', days: ['2026-05-24'], today: '2026-05-24', freeUntil: null },
      { id: SAME_B, name: 'Beta Cup', days: ['2026-05-24'], today: '2026-05-24', freeUntil: null },
    ]);
  });

  it('leaves out a draft, a test Event, an ended one and an Event I am not on', async () => {
    const ids = (await service().find.myEvents(MARC, NOW)).map((e) => e.id);
    for (const gone of [DRAFT, TEST, OVER, NOT_MINE]) expect(ids).not.toContain(gone);
  });

  it("reads only my own roster rows, and the Events' columns it needs", async () => {
    const { find, supabase } = service();
    await find.myEvents(MARC, NOW);
    expect(selectsFor(supabase.from, 'persons')).toEqual(['event_id']);
    expect(filtersFor(supabase.from, 'persons', 'eq')).toEqual([['global_person_id', MARC]]);
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, name, status, event_kind, start_date, end_date, timezone',
    ]);
    const asked = filtersFor(supabase.from, 'events', 'in')[0]![1] as string[];
    expect(asked).not.toContain(NOT_MINE);
    expect(filtersFor(supabase.from, 'events', 'gte')).toEqual([['end_date', '2026-05-22']]);
  });

  it('reads my own free-now row, live only', async () => {
    const { find, supabase } = service();
    await find.myEvents(MARC, NOW);
    expect(selectsFor(supabase.from, 'fightbook_free_now')).toEqual(['event_id, until']);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'eq')).toEqual([
      ['global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'gt')).toEqual([
      ['until', NOW.toISOString()],
    ]);
  });

  // A failed read is logged by its code or kind: a database message can echo the id it was given.
  it.each([
    [
      'answered with an error',
      () => supabaseChain({ data: null, error: { code: '57014', message: `timeout for ${MARC}` } }),
      'the free-now marks are unreadable (57014)',
    ],
    [
      'thrown',
      () => {
        throw new TypeError(`fetch failed for ${MARC}`);
      },
      'TypeError',
    ],
  ])('keeps the Events, with no free-now time, when that read is %s', async (_, read, why) => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { find, supabase } = service();
    const original = supabase.from.getMockImplementation()!;
    supabase.from.mockImplementation((table: string) =>
      table === 'fightbook_free_now' ? read() : original(table),
    );
    const events = await find.myEvents(MARC, NOW);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.freeUntil)).toEqual([null, null, null, null]);
    expect(error.mock.calls).toEqual([[`Free-now time left off: ${why}`]]);
    error.mockRestore();
  });

  it('lists nothing for a fighter on no Event, without reading Events', async () => {
    const { find, supabase } = service();
    expect(await find.myEvents('nobody', NOW)).toEqual([]);
    expect(selectsFor(supabase.from, 'events')).toEqual([]);
  });

  it('lists nothing once the last day ended at 06:00', async () => {
    const { find } = service([event(SOON, 'Zeta Open')]);
    expect(await find.myEvents(MARC, new Date('2026-05-25T04:00:00Z'))).toEqual([]);
  });
});
