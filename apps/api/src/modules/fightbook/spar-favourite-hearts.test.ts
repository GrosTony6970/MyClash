import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { SparFindService } from './spar-find.service';
import { SparReadsService } from './spar-reads.service';
import { SparThanksService } from './spar-thanks.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const OFF = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
const BLOCKED = '8354bcda-5fd1-42df-91dd-9391b1d4a289';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const NOW = new Date('2026-05-22T12:00:00Z');

const live = {
  claimed_by_user_id: ACCOUNT,
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};
const person = (id: string, given: string, over: Record<string, unknown> = {}) => ({
  id,
  ...live,
  display_name: null,
  given_name: given,
  family_name: 'Probe',
  photo_url: null,
  ...over,
});
const spar = (id: string, partner: string) => ({
  id,
  asker_global_person_id: MARC,
  receiver_global_person_id: partner,
  kind: 'free',
  event_id: null,
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  spar_time: null,
  place: 'Hall',
  weapons: [],
  message: null,
  status: 'agreed',
  expires_at: '2026-05-24T04:00:00Z',
  shared_comment: null,
  cancelled_by: null,
  cancel_message: null,
});

/** Marc hearted Julie and Off and Blocked; Julie hearted Paul (not Marc's heart). */
function setup() {
  const heart = (owner: string, favourite: string) => ({
    owner_global_person_id: owner,
    favourite_global_person_id: favourite,
  });
  const supabase = mockSupabase({
    global_persons: {
      rows: [
        person(MARC, 'Marc'),
        person(JULIE, 'Julie'),
        person(PAUL, 'Paul'),
        person(OFF, 'Olga', { fightbook_enabled: false }),
        person(BLOCKED, 'Blake'),
      ],
    },
    fightbook_blocks: {
      rows: [{ blocker_global_person_id: MARC, blocked_global_person_id: BLOCKED }],
    },
    fightbook_favourites: {
      rows: [
        heart(MARC, JULIE),
        heart(MARC, OFF),
        heart(MARC, BLOCKED),
        heart(JULIE, PAUL),
        heart(JULIE, MARC),
      ],
    },
    spar_requests: {
      rows: [
        spar('with-julie', JULIE),
        spar('with-paul', PAUL),
        spar('with-off', OFF),
        spar('with-blocked', BLOCKED),
      ],
    },
    spar_thanks: { rows: [] },
    spar_anonymous_reviews: { rows: [] },
    spar_private_notes: { rows: [] },
    spar_flags: { rows: [] },
    events: { rows: [] },
  });
  const reads = new SparReadsService(supabase as never, new SparThanksService(supabase as never));
  return { reads, find: new SparFindService(supabase as never, {} as never), supabase };
}

describe('My spars, the partner heart', () => {
  it('is true for a partner I hearted, false for one I did not, null when I cannot ask them', async () => {
    const { reads } = setup();
    const { spars } = await reads.mySpars(MARC, true, NOW);
    expect(spars.map((s) => [s.id, s.partnerFavourite])).toEqual([
      ['with-julie', true],
      ['with-paul', false],
      ['with-off', null],
      ['with-blocked', null],
    ]);
  });

  it('reads my hearts only, not the ones Julie keeps', async () => {
    const { reads, supabase } = setup();
    await reads.mySpars(MARC, true, NOW);
    expect(selectsFor(supabase.from, 'fightbook_favourites')).toEqual([
      'favourite_global_person_id',
    ]);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'eq')).toEqual([
      ['owner_global_person_id', MARC],
    ]);
  });

  it('is null on every card, and reads no hearts, when I have FightBook off', async () => {
    const { reads, supabase } = setup();
    const { spars } = await reads.mySpars(MARC, false, NOW);
    expect(spars.map((s) => s.partnerFavourite)).toEqual([null, null, null, null]);
    expect(selectsFor(supabase.from, 'fightbook_favourites')).toEqual([]);
  });
});

describe('the profile askable answer', () => {
  it('carries the heart: true for Julie, false for Paul', async () => {
    const { find } = setup();
    expect(await find.askableFighter(MARC, JULIE)).toEqual({ askable: true, favourite: true });
    expect(await find.askableFighter(MARC, PAUL)).toEqual({ askable: true, favourite: false });
  });

  it('reads my hearts only', async () => {
    const { find, supabase } = setup();
    await find.askableFighter(MARC, JULIE);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'eq')).toEqual([
      ['owner_global_person_id', MARC],
    ]);
  });
});
