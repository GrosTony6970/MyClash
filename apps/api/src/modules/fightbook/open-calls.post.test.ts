import { describe, expect, it } from 'vitest';
import { filtersFor, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  DRAFT_EVENT,
  EVENT,
  JULIE,
  LATER_EVENT,
  MARC,
  NEW_CALL,
  NOW,
  PAUL,
  TODAY,
  callRow,
  codeOf,
  world,
} from './open-calls.fixtures';

// The Event's clock is New York's, never the machine's: run under TZ=UTC and TZ=Pacific/Auckland
// too (luxon is not an API dependency, so its default zone cannot be pinned here).

const LONGSWORD = { weapons: ['longsword '], time: '15:00' };
const mine = (n: number, over: Record<string, unknown> = {}) =>
  callRow({
    id: `ca000000-0000-4000-8000-00000000010${n}`,
    poster_global_person_id: MARC,
    ...over,
  });

describe('OpenCallsService.post', () => {
  it('posts a call for today at the Event, closing at its time on the Event’s clock', async () => {
    const { open, supabase } = world();
    expect(await open.post(MARC, EVENT, LONGSWORD, NOW)).toEqual({ id: NEW_CALL });
    const [write] = writesTo(supabase, 'spar_open_calls');
    expect(write?.op).toBe('insert');
    expect(write?.row).toEqual({
      poster_global_person_id: MARC,
      event_id: EVENT,
      spar_day: TODAY,
      zone: 'America/New_York',
      spar_time: '15:00',
      weapons: ['Longsword'],
      // 15:00 in New York (UTC-4 in May).
      closes_at: '2026-05-23T19:00:00.000Z',
    });
    expect(selectsFor(supabase.from, 'weapon_catalog')).toEqual(['name']);
  });

  it('takes a call at 23:59: the Event day runs to 06:00 next morning', async () => {
    const { open, supabase } = world();
    await open.post(MARC, EVENT, { ...LONGSWORD, time: '23:59' }, NOW);
    expect(writesTo(supabase, 'spar_open_calls')[0]?.row).toMatchObject({
      spar_day: TODAY,
      closes_at: '2026-05-24T03:59:00.000Z',
    });
  });

  it('at 05:30 mid-Event, the new day is today', async () => {
    const { open, supabase } = world();
    await open.post(MARC, EVENT, { ...LONGSWORD, time: '07:00' }, new Date('2026-05-24T09:30:00Z'));
    expect(writesTo(supabase, 'spar_open_calls')[0]?.row).toMatchObject({
      spar_day: '2026-05-24',
      closes_at: '2026-05-24T11:00:00.000Z',
    });
  });

  it.each<[string, string, Date]>([
    ['a time already past', '13:59', NOW],
    ['the time it is now', '14:00', NOW],
    // Monday 05:30 in New York: today is still Sunday, the last day, and every time of it is past.
    ['a time after the last day ends', '07:00', new Date('2026-05-25T09:30:00Z')],
  ])('refuses %s: bad_time, and writes nothing', async (_, time, now) => {
    const { open, supabase } = world();
    expect(await codeOf(open.post(MARC, EVENT, { ...LONGSWORD, time }, now))).toEqual([
      400,
      'bad_time',
    ]);
    expect(writesTo(supabase, 'spar_open_calls')).toEqual([]);
  });

  it('refuses a weapon off the catalog: bad_weapon, and writes nothing', async () => {
    const { open, supabase } = world();
    const rapier = { ...LONGSWORD, weapons: ['Rapier'] };
    expect(await codeOf(open.post(MARC, EVENT, rapier, NOW))).toEqual([400, 'bad_weapon']);
    expect(writesTo(supabase, 'spar_open_calls')).toEqual([]);
  });

  it.each<[string, string, string[] | undefined]>([
    ['a draft Event', DRAFT_EVENT, undefined],
    ['an Event I am not on', EVENT, [JULIE, PAUL]],
    ['an unknown Event', 'eeeeeeee-0000-4000-8000-0000000000ff', undefined],
    ['an Event that has not started', LATER_EVENT, undefined],
  ])('refuses %s: bad_event, and writes nothing', async (_, eventId, rosterOf) => {
    const { open, supabase } = world({ rosterOf });
    expect(await codeOf(open.post(MARC, eventId, LONGSWORD, NOW))).toEqual([400, 'bad_event']);
    expect(writesTo(supabase, 'spar_open_calls')).toEqual([]);
  });

  it('refuses an Event whose days have all ended: bad_event', async () => {
    const { open } = world();
    const after = new Date('2026-05-25T10:30:00Z'); // Monday 06:30 in New York
    expect(await codeOf(open.post(MARC, EVENT, LONGSWORD, after))).toEqual([400, 'bad_event']);
  });
});

describe('OpenCallsService.post: at most 5 OPEN calls per poster per Event day (Decision 6)', () => {
  it('refuses the 6th OPEN call: too_many_calls, and writes nothing', async () => {
    const { open, supabase } = world({ calls: [1, 2, 3, 4, 5].map((n) => mine(n)) });
    expect(await codeOf(open.post(MARC, EVENT, LONGSWORD, NOW))).toEqual([400, 'too_many_calls']);
    expect(writesTo(supabase, 'spar_open_calls')).toEqual([]);
  });

  it('counts only OPEN calls of mine, at this Event, today', async () => {
    const { open, supabase } = world({
      calls: [
        ...[1, 2, 3, 4].map((n) => mine(n)),
        mine(5, { status: 'closed' }),
        mine(6, { closes_at: '2026-05-23T17:00:00+00:00' }), // past its time
        mine(7, { spar_day: '2026-05-24' }),
        mine(8, { event_id: LATER_EVENT }),
        callRow({ id: 'ca000000-0000-4000-8000-000000000109' }), // Julie's
      ],
    });
    expect(await open.post(MARC, EVENT, LONGSWORD, NOW)).toEqual({ id: NEW_CALL });
    expect(selectsFor(supabase.from, 'spar_open_calls')[0]).toBe('id');
    expect(filtersFor(supabase.from, 'spar_open_calls', 'eq')).toEqual([
      ['poster_global_person_id', MARC],
      ['event_id', EVENT],
      ['spar_day', TODAY],
      ['status', 'open'],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'gt')).toEqual([
      ['closes_at', NOW.toISOString()],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'limit')).toEqual([[5]]);
  });
});

describe('OpenCallsService.close', () => {
  it("closes the caller's open call, and only theirs", async () => {
    const { open, supabase } = world({ calls: [mine(1)] });
    await open.close(MARC, mine(1).id as string);
    const [write] = writesTo(supabase, 'spar_open_calls');
    expect(write?.op).toBe('update');
    expect(write?.row).toEqual({ status: 'closed' });
    expect(scopedTo(write, 'id')).toBe(mine(1).id);
    expect(scopedTo(write, 'poster_global_person_id')).toBe(MARC);
    expect(scopedTo(write, 'status')).toBe('open');
  });

  it('is quiet on a call already closed (two taps)', async () => {
    const { open } = world({ calls: [mine(1, { status: 'closed' })] });
    await expect(open.close(MARC, mine(1).id as string)).resolves.toBeUndefined();
  });

  it('answers 409 not_open on a call already picked: the spar is cancelled in My spars', async () => {
    const picked = mine(1, { status: 'picked', picked_global_person_id: PAUL });
    const { open } = world({ calls: [picked] });
    expect(await codeOf(open.close(MARC, picked.id as string))).toEqual([409, 'not_open']);
  });

  it.each([
    ['a stranger’s call', callRow().id as string],
    ['an unknown call', 'ca000000-0000-4000-8000-0000000000ee'],
  ])('answers 404 for %s, never 403', async (_, id) => {
    const { open } = world({ calls: [callRow()] });
    expect((await codeOf(open.close(MARC, id)))[0]).toBe(404);
  });
});
