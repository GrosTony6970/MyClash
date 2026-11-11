import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { SparReadsService } from './spar-reads.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const NOW = new Date('2026-05-22T12:00:00Z');

const SPAR_SELECT =
  'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message';

const request = (id: string, over: Record<string, unknown>) => ({
  id,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  kind: 'event',
  event_id: EVENT,
  spar_day: '2026-05-23',
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

/** Every profile live, claimed and on, unless `changed` says otherwise. */
function service(
  rows: Record<string, unknown>[],
  changed: Record<string, Record<string, unknown>> = {},
) {
  const live = {
    claimed_by_user_id: '9a8b7c6d-1111-4222-8333-944455566677',
    fightbook_enabled: true,
    deleted_at: null,
    merged_into_id: null,
    account_deleted_at: null,
  };
  const person = (id: string, names: Record<string, unknown>) => ({
    id,
    ...live,
    ...names,
    ...changed[id],
  });
  const supabase = mockSupabase({
    spar_requests: { rows },
    global_persons: {
      rows: [
        person(MARC, {
          display_name: null,
          given_name: 'Marc',
          family_name: 'Probe',
          photo_url: null,
        }),
        person(JULIE, {
          display_name: 'Julie P.',
          given_name: 'Julie',
          family_name: 'Probe',
          photo_url: 'j.jpg',
        }),
        person(PAUL, {
          display_name: null,
          given_name: 'Paul',
          family_name: 'Probe',
          photo_url: null,
        }),
      ],
    },
    events: { rows: [{ id: EVENT, name: 'Probe Open' }] },
  });
  return { reads: new SparReadsService(supabase as never), supabase };
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
      'id, display_name, given_name, family_name, photo_url',
    ]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['id, name']);
  });

  it('leaves out a request its asker can no longer be answered on (off, merged, unclaimed)', async () => {
    // Paul switched off and Julie's profile was merged away after they asked: a Yes would only
    // answer "no longer open", and the page would read the card back after it.
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
    const { sent } = await reads.mySpars(MARC, NOW);
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
    const { sent } = await reads.mySpars(MARC, NOW);
    expect(sent.map((s) => s.id)).toEqual(['far']);
    expect(filtersFor(supabase.from, 'spar_requests', 'gte')).toEqual([
      ['spar_day', '2026-04-22'],
      ['spar_day', '2026-04-22'],
      ['spar_day', '2026-04-22'],
    ]);
  });

  it('lists my agreed spars both ways, and leaves withdrawn requests out', async () => {
    const { reads, supabase } = service([
      request('mine', { status: 'agreed', spar_day: '2026-05-24' }),
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
    const { spars, sent } = await reads.mySpars(MARC, NOW);
    expect(spars.map((s) => [s.id, s.partner.name, s.iAsked, s.cancelledByMe])).toEqual([
      ['theirs', 'Paul Probe', false, false],
      ['mine', 'Julie P.', true, null],
    ]);
    expect(sent).toEqual([]);
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([
      ['asker_global_person_id', MARC],
      ['receiver_global_person_id', MARC],
      ['asker_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'in')).toEqual([
      ['status', ['agreed', 'cancelled']],
      ['status', ['agreed', 'cancelled']],
      ['status', ['pending', 'not_this_time']],
    ]);
  });
});
