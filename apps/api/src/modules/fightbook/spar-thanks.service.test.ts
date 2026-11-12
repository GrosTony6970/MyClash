import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { SparReadsService } from './spar-reads.service';
import { SparThanksService } from './spar-thanks.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const WITH_JULIE = '5b000000-0000-4000-8000-00000000000a';
const WITH_PAUL = '5b000000-0000-4000-8000-00000000000b';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const NOW = new Date('2026-05-30T12:00:00Z');

const review = (
  request: string,
  author: string,
  subject: string,
  stars: number,
  body?: string,
) => ({
  id: `${request}-${author}`,
  spar_request_id: request,
  author_global_person_id: author,
  subject_global_person_id: subject,
  stars,
  ...(body === undefined ? {} : { body }),
});

const person = (id: string, given: string) => ({
  id,
  display_name: null,
  given_name: given,
  family_name: 'Probe',
  photo_url: null,
});

const spar = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  kind: 'event',
  event_id: EVENT,
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  spar_time: '18:30:00',
  place: null,
  weapons: ['Longsword'],
  message: null,
  status: 'done',
  expires_at: '2026-05-24T04:00:00+00:00',
  shared_comment: null,
  cancelled_by: null,
  cancel_message: null,
  ...over,
});

function setup(tables: {
  thanks?: Record<string, unknown>[];
  anonymous?: Record<string, unknown>[];
  notes?: Record<string, unknown>[];
  spars?: Record<string, unknown>[];
}) {
  const supabase = mockSupabase({
    spar_thanks: { rows: tables.thanks ?? [] },
    spar_anonymous_reviews: { rows: tables.anonymous ?? [] },
    spar_private_notes: { rows: tables.notes ?? [] },
    spar_requests: { rows: tables.spars ?? [] },
    global_persons: { rows: [person(MARC, 'Marc'), person(JULIE, 'Julie'), person(PAUL, 'Paul')] },
    events: { rows: [{ id: EVENT, name: 'Probe Open' }] },
  });
  const thanks = new SparThanksService(supabase as never);
  return { thanks, reads: new SparReadsService(supabase as never, thanks), supabase };
}

describe('SparThanksService.cardExtras', () => {
  it('reads only what the caller wrote, and the partner’s signed thank-you to the caller', async () => {
    const { thanks, supabase } = setup({
      thanks: [
        review(WITH_JULIE, MARC, JULIE, 5, 'Great bout'),
        review(WITH_JULIE, JULIE, MARC, 4, 'Thanks!'),
        review(WITH_PAUL, PAUL, JULIE, 2, 'Not about Marc'), // another author AND subject
      ],
      anonymous: [review(WITH_PAUL, MARC, PAUL, 3), review(WITH_JULIE, JULIE, MARC, 1)],
      notes: [
        { spar_request_id: WITH_JULIE, author_global_person_id: MARC, body: 'Work on my guard' },
        { spar_request_id: WITH_JULIE, author_global_person_id: JULIE, body: 'Julie’s own' },
      ],
    });
    const extras = await thanks.cardExtras(MARC, [WITH_JULIE, WITH_PAUL]);
    expect(Object.fromEntries(extras)).toEqual({
      [WITH_JULIE]: {
        myReview: { stars: 5, text: 'Great bout', anonymous: false },
        theirThanks: { stars: 4, text: 'Thanks!' },
        note: 'Work on my guard',
      },
      [WITH_PAUL]: {
        myReview: { stars: 3, text: null, anonymous: true },
        theirThanks: null,
        note: null,
      },
    });
    expect(selectsFor(supabase.from, 'spar_thanks')).toEqual([
      'spar_request_id, stars, body',
      'spar_request_id, stars, body',
    ]);
    expect(filtersFor(supabase.from, 'spar_thanks', 'eq')).toEqual([
      ['author_global_person_id', MARC],
      ['subject_global_person_id', MARC],
    ]);
    expect(selectsFor(supabase.from, 'spar_anonymous_reviews')).toEqual(['spar_request_id, stars']);
    expect(filtersFor(supabase.from, 'spar_anonymous_reviews', 'eq')).toEqual([
      ['author_global_person_id', MARC],
    ]);
    expect(selectsFor(supabase.from, 'spar_private_notes')).toEqual(['spar_request_id, body']);
    expect(filtersFor(supabase.from, 'spar_private_notes', 'eq')).toEqual([
      ['author_global_person_id', MARC],
    ]);
    for (const table of ['spar_thanks', 'spar_anonymous_reviews', 'spar_private_notes'] as const) {
      for (const filter of filtersFor(supabase.from, table, 'in')) {
        expect(filter).toEqual(['spar_request_id', [WITH_JULIE, WITH_PAUL]]);
      }
    }
  });

  it('reads nothing for no spars', async () => {
    const { thanks, supabase } = setup({});
    expect((await thanks.cardExtras(MARC, [])).size).toBe(0);
    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('an anonymous review by the partner about me leaves my card deep-equal to the card without it', async () => {
    // Julie reviews Marc anonymously: his card must not change by one byte, or it names her.
    const spars = [spar(WITH_JULIE)];
    const without = await setup({ spars }).reads.mySpars(MARC, NOW);
    const withIt = await setup({
      spars,
      anonymous: [review(WITH_JULIE, JULIE, MARC, 1)],
    }).reads.mySpars(MARC, NOW);
    expect(withIt).toEqual(without);
    expect(withIt.spars[0]).toMatchObject({ status: 'done', theirThanks: null, myReview: null });
  });

  it('puts what was written on the spar card, beside its windows', async () => {
    const { reads } = setup({
      spars: [spar(WITH_JULIE)],
      thanks: [review(WITH_JULIE, JULIE, MARC, 4, 'Thanks!')],
      notes: [{ spar_request_id: WITH_JULIE, author_global_person_id: MARC, body: 'Guard' }],
    });
    const { spars } = await reads.mySpars(MARC, NOW);
    expect(spars[0]).toMatchObject({
      status: 'done',
      markFrom: '2026-05-22T22:00:00.000Z',
      markUntil: '2026-05-26T04:00:00.000Z',
      cancelUntil: '2026-05-24T04:00:00.000Z',
      myReview: null,
      theirThanks: { stars: 4, text: 'Thanks!' },
      note: 'Guard',
      partnerFavourite: null,
    });
  });
});

/** `count` thank-yous Julie wrote to Marc, newest last; and one Marc wrote to Julie, newest of all. */
function thanksRows(count: number) {
  const toMarc = Array.from({ length: count }, (_, i) => ({
    ...review(WITH_JULIE, JULIE, MARC, 4, `Thanks ${i}`),
    id: `t-${String(i).padStart(2, '0')}`,
    created_at: `2026-05-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T10:00:00Z`,
  }));
  const toJulie = {
    ...review(WITH_JULIE, MARC, JULIE, 5, 'To Julie'),
    id: 't-julie',
    created_at: '2026-05-29T10:00:00Z',
  };
  return [...toMarc, toJulie];
}

describe('SparThanksService.received', () => {
  it('lists the signed thank-yous to me, newest first then by id, 20 a page', async () => {
    const { thanks, supabase } = setup({ thanks: thanksRows(22), spars: [spar(WITH_JULIE)] });
    const first = await thanks.received(MARC, 0);
    expect(first.more).toBe(true);
    expect(first.items.map((t) => t.id)).toEqual([
      't-21',
      't-20',
      ...Array.from({ length: 18 }, (_, i) => `t-${String(19 - i).padStart(2, '0')}`),
    ]);
    expect(first.items[0]).toEqual({
      id: 't-21',
      from: { globalPersonId: JULIE, name: 'Julie Probe', photoUrl: null, club: null },
      kind: 'event',
      eventName: 'Probe Open',
      day: '2026-05-23',
      time: '18:30',
      place: null,
      weapons: ['Longsword'],
      stars: 4,
      text: 'Thanks 21',
    });
    expect(selectsFor(supabase.from, 'spar_thanks')).toEqual([
      'id, spar_request_id, author_global_person_id, stars, body',
    ]);
    expect(filtersFor(supabase.from, 'spar_thanks', 'eq')).toEqual([
      ['subject_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_thanks', 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(filtersFor(supabase.from, 'spar_thanks', 'range')).toEqual([[0, 20]]);
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual([
      'id, kind, event_id, spar_day, spar_time, place, weapons',
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'in')).toEqual([['id', [WITH_JULIE]]]);
  });

  it('ends on the last page, and never lists one I wrote', async () => {
    const { thanks, supabase } = setup({ thanks: thanksRows(22), spars: [spar(WITH_JULIE)] });
    const last = await thanks.received(MARC, 1);
    expect(last.items.map((t) => t.id)).toEqual(['t-01', 't-00']);
    expect(last.more).toBe(false);
    expect(filtersFor(supabase.from, 'spar_thanks', 'range')).toEqual([[20, 40]]);
  });

  it('answers an empty page, reading nothing more', async () => {
    const { thanks, supabase } = setup({ thanks: thanksRows(0) });
    expect(await thanks.received(MARC, 0)).toEqual({ items: [], more: false });
    expect(queriedTables(supabase.from)).toEqual(['spar_thanks']);
  });
});
