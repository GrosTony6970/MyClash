import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { FightBookFavouritesService } from './fightbook-favourites.service';
import { SparFindService } from './spar-find.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const OFF = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
const UNCLAIMED = '4f107e96-1b9d-4e9b-9d99-5f5d7d906e45';
const MERGED = '50218fa7-2cae-4fac-8eaa-606e8ea17f56';
const BLOCKED = '8354bcda-5fd1-42df-91dd-9391b1d4a289';
const BLOCKER = '9465cdeb-60e2-43e0-a2ee-a4a2c2e5b39a';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';

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
  clubs: null,
  ...over,
});
const heart = (owner: string, favourite: string) => ({
  owner_global_person_id: owner,
  favourite_global_person_id: favourite,
});

/** Marc hearted Julie, Off, Blocked and Blocker; Julie hearted Paul (not Marc's to see). */
function setup(favourites = [heart(MARC, JULIE)]) {
  const supabase = mockSupabase({
    global_persons: {
      rows: [
        person(MARC, 'Marc'),
        person(JULIE, 'Julie'),
        person(PAUL, 'Paul'),
        person(OFF, 'Olga', { fightbook_enabled: false }),
        person(UNCLAIMED, 'Uma', { claimed_by_user_id: null }),
        person(MERGED, 'Mia', { merged_into_id: JULIE }),
        person(BLOCKED, 'Blake'),
        person(BLOCKER, 'Alex'),
      ],
    },
    fightbook_blocks: {
      rows: [
        { blocker_global_person_id: MARC, blocked_global_person_id: BLOCKED },
        { blocker_global_person_id: BLOCKER, blocked_global_person_id: MARC },
      ],
    },
    fightbook_favourites: { rows: [...favourites, heart(JULIE, PAUL)] },
    fighter_weapons: { rows: [] },
  });
  const find = new SparFindService(supabase as never, {} as never);
  return { service: new FightBookFavouritesService(supabase as never, find), supabase };
}

describe('FightBookFavouritesService.add', () => {
  it.each([
    ['switched off', OFF],
    ['unclaimed', UNCLAIMED],
    ['merged away', MERGED],
    ['myself', MARC],
  ])('answers 404 for a fighter %s, and writes nothing', async (_, target) => {
    const { service, supabase } = setup();
    await expect(service.add(MARC, target)).rejects.toBeInstanceOf(NotFoundException);
    expect(writesTo(supabase, 'fightbook_favourites')).toEqual([]);
  });

  it('hearts a fighter on FightBook, as the caller', async () => {
    const { service, supabase } = setup();
    await service.add(MARC, PAUL);
    expect(writesTo(supabase, 'fightbook_favourites').map((w) => [w.op, w.row])).toEqual([
      ['upsert', heart(MARC, PAUL)],
    ]);
    expect(selectsFor(supabase.from, 'fightbook_favourites')).toEqual([
      'favourite_global_person_id',
    ]);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'eq')).toEqual([
      ['owner_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'limit')).toEqual([[200]]);
  });

  it('is 204 when the heart is already there (the upsert ignores the pair)', async () => {
    const { service, supabase } = setup();
    await expect(service.add(MARC, JULIE)).resolves.toBeUndefined();
    const upsert = supabase.from.mock.results
      .map((r) => r.value as { upsert?: { mock: { calls: unknown[][] } } })
      .find((chain) => chain.upsert?.mock.calls.length);
    expect(upsert?.upsert?.mock.calls[0]?.[1]).toEqual({
      onConflict: 'owner_global_person_id,favourite_global_person_id',
      ignoreDuplicates: true,
    });
  });

  it('answers 409 favourites_full at 200, but still 204 for one already there', async () => {
    const full = Array.from({ length: 199 }, (_, i) => heart(MARC, `fan-${i}`));
    const { service, supabase } = setup([heart(MARC, JULIE), ...full]);
    const error = await service.add(MARC, PAUL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'favourites_full' });
    expect(writesTo(supabase, 'fightbook_favourites')).toEqual([]);
    await expect(service.add(MARC, JULIE)).resolves.toBeUndefined();
  });
});

describe('FightBookFavouritesService.remove', () => {
  it('deletes only my own heart', async () => {
    const { service, supabase } = setup();
    await service.remove(MARC, PAUL);
    const [write] = writesTo(supabase, 'fightbook_favourites');
    expect(write?.op).toBe('delete');
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['owner_global_person_id', MARC],
      ['favourite_global_person_id', PAUL],
    ]);
  });
});

describe('FightBookFavouritesService.list', () => {
  const all = [
    heart(MARC, JULIE),
    heart(MARC, OFF),
    heart(MARC, BLOCKED),
    heart(MARC, BLOCKER),
    heart(MARC, MERGED),
  ];

  it('lists my favourites by name: not one I blocked or who left, yes one who blocked me', async () => {
    const { service } = setup(all);
    const cards = await service.list(MARC);
    expect(cards.map((c) => [c.fighter.name, c.favourite])).toEqual([
      ['Alex Probe', true],
      ['Julie Probe', true],
    ]);
  });

  it('reads only my hearts, and not those Julie keeps', async () => {
    const { service, supabase } = setup(all);
    await service.list(MARC);
    expect(selectsFor(supabase.from, 'fightbook_favourites')).toEqual([
      'favourite_global_person_id',
    ]);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'eq')).toEqual([
      ['owner_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_favourites', 'limit')).toEqual([[200]]);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
  });

  it('reads nothing of the fighters when there are no hearts', async () => {
    const { service } = setup([]);
    expect(await service.list(MARC)).toEqual([]);
  });
});
