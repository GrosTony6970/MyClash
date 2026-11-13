import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { SparReadsService } from './spar-reads.service';
import { SparThanksService } from './spar-thanks.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const NOW = new Date('2026-05-22T12:00:00Z');

const SPAR_SELECT =
  'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message';

const request = (id: string, over: Record<string, unknown>) => ({
  id,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  kind: 'event',
  event_id: EVENT,
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  spar_time: null,
  place: null,
  weapons: ['Longsword'],
  message: null,
  status: 'pending',
  expires_at: '2026-05-24T04:00:00Z',
  shared_comment: null,
  cancelled_by: null,
  cancel_message: null,
  created_at: '2026-05-21T10:00:00Z',
  ...over,
});

const block = (blocker: string, blocked: string) => ({
  id: `${blocker}-${blocked}`,
  blocker_global_person_id: blocker,
  blocked_global_person_id: blocked,
});

/** The one query builder `table` was asked for. */
function chainOf(supabase: ReturnType<typeof service>['supabase'], table: string) {
  const index = supabase.from.mock.calls.findIndex(([queried]) => queried === table);
  return supabase.from.mock.results[index]!.value as {
    not: { mock: { invocationCallOrder: number[] } };
    limit: { mock: { invocationCallOrder: number[] } };
  };
}

const LIVE = {
  claimed_by_user_id: '9a8b7c6d-1111-4222-8333-944455566677',
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};

/** Marc, Julie and Paul: every profile live, claimed and on, unless `changed` says otherwise. */
function people(changed: Record<string, Record<string, unknown>>) {
  const person = (id: string, names: Record<string, unknown>) => ({
    id,
    ...LIVE,
    ...names,
    ...changed[id],
  });
  return [
    person(MARC, { display_name: null, given_name: 'Marc', family_name: 'Probe', photo_url: null }),
    person(JULIE, {
      display_name: 'Julie P.',
      given_name: 'Julie',
      family_name: 'Probe',
      photo_url: 'j.jpg',
    }),
    person(PAUL, { display_name: null, given_name: 'Paul', family_name: 'Probe', photo_url: null }),
  ];
}

function service(
  rows: Record<string, unknown>[],
  changed: Record<string, Record<string, unknown>> = {},
  blocks: Record<string, unknown>[] = [],
) {
  const supabase = mockSupabase({
    spar_requests: { rows },
    fightbook_blocks: { rows: blocks },
    global_persons: { rows: people(changed) },
    events: { rows: [{ id: EVENT, name: 'Probe Open' }] },
    spar_thanks: { rows: [] },
    spar_anonymous_reviews: { rows: [] },
    spar_private_notes: { rows: [] },
    spar_flags: { rows: [] },
  });
  const thanks = new SparThanksService(supabase as never);
  return { reads: new SparReadsService(supabase as never, thanks), supabase };
}

describe('SparReadsService.inbox', () => {
  it('lists the requests waiting for my answer, with the asker and the Event', async () => {
    const { reads, supabase } = service([
      request('r-1', { asker_global_person_id: PAUL, receiver_global_person_id: MARC }),
      request('r-2', {}), // mine to Julie: not my inbox
    ]);
    const inbox = await reads.inbox(MARC, NOW);
    expect(inbox.map((r) => [r.id, r.asker.name, r.eventName])).toEqual([
      ['r-1', 'Paul Probe', 'Probe Open'],
    ]);
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual([SPAR_SELECT]);
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([
      ['receiver_global_person_id', MARC],
      ['status', 'pending'],
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'gt')).toEqual([
      ['expires_at', NOW.toISOString()],
    ]);
    expect(selectsFor(supabase.from, 'global_persons')).toEqual([
      'id',
      'id, display_name, given_name, family_name, photo_url, clubs(name)',
    ]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['id, name']);
  });

  it('leaves out a request its asker can no longer be answered on (off, merged, unclaimed)', async () => {
    // Paul asked Julie, then switched off (a merge, a delete or an unclaim end the same way, by
    // the reachable filters asserted below): her Yes would only answer "no longer open", and
    // the page would read the card back after it.
    const { reads, supabase } = service(
      [
        request('from-marc', { asker_global_person_id: MARC, receiver_global_person_id: JULIE }),
        request('from-paul', { asker_global_person_id: PAUL, receiver_global_person_id: JULIE }),
      ],
      { [PAUL]: { fightbook_enabled: false } },
    );
    const inbox = await reads.inbox(JULIE, NOW);
    expect(inbox.map((r) => r.id)).toEqual(['from-marc']);
    expect(selectsFor(supabase.from, 'global_persons')[0]).toBe('id');
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([
      ['fightbook_enabled', true],
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'not')).toEqual([
      ['claimed_by_user_id', 'is', null],
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'is')).toEqual([
      ['deleted_at', null],
      ['merged_into_id', null],
      ['account_deleted_at', null],
    ]);
  });

  it('leaves out, in its query, a request whose asker I blocked; keeps one whose asker blocked me', async () => {
    // Marc blocked Paul: Paul's scan or ask never reaches him (ruling 714). Julie blocked Marc:
    // her request to him still shows, for only the blocks the caller made are read (ruling 672).
    const { reads, supabase } = service(
      [
        request('from-paul', { asker_global_person_id: PAUL, receiver_global_person_id: MARC }),
        request('from-julie', { asker_global_person_id: JULIE, receiver_global_person_id: MARC }),
      ],
      {},
      [block(MARC, PAUL), block(JULIE, MARC)],
    );
    const inbox = await reads.inbox(MARC, NOW);
    expect(inbox.map((r) => r.id)).toEqual(['from-julie']);
    expect(selectsFor(supabase.from, 'fightbook_blocks')).toEqual(['blocked_global_person_id']);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'not')).toEqual([
      ['asker_global_person_id', 'in', `(${PAUL})`],
    ]);
    // In the query before its cap, so 200 requests from blocked askers cannot fill it.
    const query = chainOf(supabase, 'spar_requests');
    expect(query.not.mock.invocationCallOrder[0]).toBeLessThan(
      query.limit.mock.invocationCallOrder[0]!,
    );
  });

  it('past the in-list limit of blocks, still leaves out an asker I blocked', async () => {
    const others = Array.from(
      { length: IN_LIST_MAX },
      (_, i) => `b1000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const { reads, supabase } = service(
      [request('from-paul', { asker_global_person_id: PAUL, receiver_global_person_id: MARC })],
      {},
      [...others.map((id) => block(MARC, id)), block(MARC, PAUL)],
    );
    expect(await reads.inbox(MARC, NOW)).toEqual([]);
    expect(filtersFor(supabase.from, 'spar_requests', 'not')).toEqual([
      ['asker_global_person_id', 'in', `(${others.join(',')})`],
    ]);
  });

  it('reads nothing more for an empty inbox', async () => {
    const { reads, supabase } = service([]);
    expect(await reads.inbox(MARC, NOW)).toEqual([]);
    expect(selectsFor(supabase.from, 'global_persons')).toEqual([]);
  });
});

describe('SparReadsService.mySpars', () => {
  it('gives the asker one payload for every kind of "Not this time", end to end', async () => {
    const { reads } = service([
      request('declined', { status: 'not_this_time' }),
      request('blocked', { status: 'not_this_time' }),
      request('swept', { status: 'not_this_time', expires_at: '2026-05-21T04:00:00Z' }),
      request('unswept', { status: 'pending', expires_at: '2026-05-21T04:00:00Z' }),
    ]);
    const { sent } = await reads.mySpars(MARC, false, NOW);
    expect(sent).toHaveLength(4);
    const bodies = sent.map(({ id: _id, ...rest }) => JSON.stringify(rest));
    expect(new Set(bodies).size).toBe(1);
  });

  it('keeps a request still waiting for a far day, however long ago it was asked', async () => {
    // Marc asked Julie 40 days ago for a day 3 weeks ahead: hidden, he would meet "already
    // asked" for a request he cannot see. Every list looks back by the spar's DAY.
    const { reads, supabase } = service([
      request('far', { spar_day: '2026-06-12', created_at: '2026-04-12T10:00:00Z' }),
      request('old', { status: 'not_this_time', spar_day: '2026-04-10' }),
    ]);
    const { sent } = await reads.mySpars(MARC, false, NOW);
    expect(sent.map((s) => s.id)).toEqual(['far']);
    expect(filtersFor(supabase.from, 'spar_requests', 'gte')).toEqual([
      ['spar_day', '2026-04-22'],
      ['spar_day', '2026-04-22'],
      ['spar_day', '2026-04-22'],
    ]);
  });

  it('lists my agreed and done spars both ways, and leaves withdrawn requests out', async () => {
    const { reads, supabase } = service([
      request('mine', { status: 'agreed', spar_day: '2026-05-24' }),
      request('sparred', { status: 'done', spar_day: '2026-05-25' }),
      request('theirs', {
        asker_global_person_id: PAUL,
        receiver_global_person_id: MARC,
        status: 'cancelled',
        cancelled_by: 'asker',
        cancel_message: 'Injured',
      }),
      request('gone', { status: 'withdrawn' }),
      // Not Marc's: each list must leave them out (a filter with no excluded row holds nothing).
      request('pauls-ask', { asker_global_person_id: PAUL, receiver_global_person_id: JULIE }),
      request('pauls-spar', {
        asker_global_person_id: PAUL,
        receiver_global_person_id: JULIE,
        status: 'agreed',
      }),
      request('to-marc', { asker_global_person_id: JULIE, receiver_global_person_id: MARC }),
    ]);
    const { spars, sent } = await reads.mySpars(MARC, false, NOW);
    expect(spars.map((s) => [s.id, s.partner.name, s.iAsked, s.status, s.cancelledByMe])).toEqual([
      ['theirs', 'Paul Probe', false, 'cancelled', false],
      ['mine', 'Julie P.', true, 'agreed', null],
      ['sparred', 'Julie P.', true, 'done', null],
    ]);
    expect(sent).toEqual([]);
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual([
      SPAR_SELECT,
      SPAR_SELECT,
      SPAR_SELECT,
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([
      ['asker_global_person_id', MARC],
      ['receiver_global_person_id', MARC],
      ['asker_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'in')).toEqual([
      ['status', ['agreed', 'cancelled', 'done']],
      ['status', ['agreed', 'cancelled', 'done']],
      ['status', ['pending', 'not_this_time']],
    ]);
    // What was written on them is read for exactly these three spars, in day order.
    expect(filtersFor(supabase.from, 'spar_private_notes', 'in')).toEqual([
      ['spar_request_id', ['theirs', 'mine', 'sparred']],
    ]);
  });
});
