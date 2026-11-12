import { ForbiddenException, type HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { SparFindService } from './spar-find.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const OFF = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
const OUTSIDER = '4f107e96-1b9d-4e9b-9d99-5f5d7d906e45';
const BLOCKED = '8354bcda-5fd1-42df-91dd-9391b1d4a289';
const BLOCKER = '9465cdeb-60e2-43e0-a2ee-a4a2c2e5b39a';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const WEAPON = 'a1000000-0000-4000-8000-000000000001';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const OTHER_EVENT = 'eeeeeeee-0000-4000-8000-00000000000b';
const DRAFT_EVENT = 'eeeeeeee-0000-4000-8000-00000000000c';
const reader: PublicReader = { userId: ACCOUNT, staff: null };

const fighter = (id: string, displayName: string, over: Record<string, unknown> = {}) => ({
  id,
  display_name: displayName,
  given_name: null,
  family_name: null,
  photo_url: null,
  clubs: null,
  claimed_by_user_id: ACCOUNT,
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  ...over,
});
const event = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
  ...over,
});
const roster = (id: string, eventId: string, globalPersonId: string | null) => ({
  id,
  event_id: eventId,
  global_person_id: globalPersonId,
});
const weapon = (globalPersonId: string, name: string, favorite = false, sortOrder = 0) => ({
  global_person_id: globalPersonId,
  favorite,
  sort_order: sortOrder,
  weapon_catalog: { name },
});
const block = (blocker: string, blocked: string) => ({
  blocker_global_person_id: blocker,
  blocked_global_person_id: blocked,
});

// Lower-case "alpha" sorts before "Bravo" only when the sort ignores case.
const fighters = [
  fighter(MARC, 'Marc Self'),
  fighter(JULIE, 'alpha Fighter', { clubs: { name: 'Club A' } }),
  fighter(BLOCKER, 'Bravo Fighter'),
  fighter(BLOCKED, 'Charlie Fighter'),
  fighter(OFF, 'Delta Fighter', { fightbook_enabled: false }),
  fighter(PAUL, 'Echo Fighter'),
  fighter(OUTSIDER, 'Foxtrot Fighter'),
];

const persons = [
  roster('p-me', EVENT, MARC),
  roster('p-julie', EVENT, JULIE),
  roster('p-blocker', EVENT, BLOCKER),
  roster('p-blocked', EVENT, BLOCKED),
  roster('p-off', EVENT, OFF),
  roster('p-none', EVENT, null),
  roster('p-hidden', EVENT, PAUL),
  roster('p-outsider', OTHER_EVENT, OUTSIDER),
  roster('p-draft-me', DRAFT_EVENT, MARC),
  roster('p-draft-julie', DRAFT_EVENT, JULIE),
];

function service({ insider = false } = {}) {
  const supabase = mockSupabase({
    global_persons: { rows: fighters },
    // I blocked Charlie; Bravo blocked me, which must change nothing I see (ruling 672).
    fightbook_blocks: { rows: [block(MARC, BLOCKED), block(BLOCKER, MARC)] },
    events: { rows: [event(EVENT), event(OTHER_EVENT), event(DRAFT_EVENT, { status: 'draft' })] },
    persons: { rows: persons },
    fighter_weapons: {
      rows: [
        weapon(JULIE, 'Sabre', false, 0),
        weapon(JULIE, 'Longsword', true, 1),
        weapon(JULIE, 'Rapier', false, 2),
        weapon(JULIE, 'Messer', false, 3),
        weapon(OUTSIDER, 'Dagger'),
      ],
    },
    // Paul is entered only in a draft Tournament: the public roster does not list him.
    tournaments: {
      rows: [
        { id: 't-open', event_id: EVENT, status: 'published' },
        { id: 't-draft', event_id: EVENT, status: 'draft' },
      ],
    },
    registrations: {
      rows: [
        { person_id: 'p-julie', tournament_id: 't-open', status: 'registered' },
        { person_id: 'p-hidden', tournament_id: 't-draft', status: 'registered' },
      ],
    },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
  });
  const orgs = {
    assertOrgRole: async () => {
      if (!insider) throw new ForbiddenException('Not a member');
    },
  };
  return { find: new SparFindService(supabase as never, orgs as never), supabase };
}

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return [error.getStatus(), (error.getResponse() as { code?: string }).code];
}

describe('SparFindService.atEvent', () => {
  it('lists the askable fighters on that Event, by name ignoring case, with their cards', async () => {
    const { find } = service();
    expect(await find.atEvent(MARC, EVENT, undefined, reader)).toEqual([
      {
        fighter: { globalPersonId: JULIE, name: 'alpha Fighter', photoUrl: null, club: 'Club A' },
        weapons: ['Longsword', 'Sabre', 'Rapier'],
      },
      {
        fighter: { globalPersonId: BLOCKER, name: 'Bravo Fighter', photoUrl: null, club: null },
        weapons: [],
      },
    ]);
  });

  it('reads the roster of that Event only, and the askable fighters among it', async () => {
    const { find, supabase } = service();
    await find.atEvent(MARC, EVENT, undefined, reader);
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, status, organization_id, event_kind',
    ]);
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
    expect(selectsFor(supabase.from, 'persons')).toContain('id, global_person_id');
    expect(filtersFor(supabase.from, 'persons', 'eq')).toContainEqual(['event_id', EVENT]);
    expect(selectsFor(supabase.from, 'global_persons')[0]).toBe('id');
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([
      ['fightbook_enabled', true],
    ]);
    expect(selectsFor(supabase.from, 'fightbook_blocks')).toEqual(['blocked_global_person_id']);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
  });

  // The control for the hidden entrant: Paul is askable, so only the draft entry hid him.
  it("shows the draft Tournament's entrant to a member of the Event's club", async () => {
    const { find } = service({ insider: true });
    const names = (await find.atEvent(MARC, EVENT, undefined, reader)).map((c) => c.fighter.name);
    expect(names).toEqual(['alpha Fighter', 'Bravo Fighter', 'Echo Fighter']);
  });

  it.each([
    ['a draft Event I am on', DRAFT_EVENT],
    ['a public Event I am not on', OTHER_EVENT],
    ['an unknown Event', 'eeeeeeee-0000-4000-8000-0000000000ff'],
  ])('refuses %s: bad_event', async (_, id) => {
    const { find, supabase } = service();
    expect(await codeOf(find.atEvent(MARC, id, undefined, reader))).toEqual([400, 'bad_event']);
    expect(selectsFor(supabase.from, 'global_persons')).toEqual([]);
  });

  // The double compares a dotted column with the row's own key and finds nothing, so these assert
  // the query only; the probe on a real PostgREST is the behaviour test (task 6 report).
  it('filters on a weapon through the inner-joined embed', async () => {
    const { find, supabase } = service();
    await find.atEvent(MARC, EVENT, WEAPON, reader);
    expect(selectsFor(supabase.from, 'global_persons')[0]).toBe(
      'id, fighter_weapons!inner(weapon_id)',
    );
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toContainEqual([
      'fighter_weapons.weapon_id',
      WEAPON,
    ]);
  });

  it('names no weapon embed and no weapon filter without a weapon', async () => {
    const { find, supabase } = service();
    await find.atEvent(MARC, EVENT, undefined, reader);
    expect(selectsFor(supabase.from, 'global_persons').join()).not.toContain('fighter_weapons');
    expect(filtersFor(supabase.from, 'global_persons', 'eq').flat()).not.toContain(
      'fighter_weapons.weapon_id',
    );
  });
});

// Review Focus 6: an Event of 300 answers, each `.in()` carrying at most 200 ids.
describe('SparFindService.atEvent, a large Event', () => {
  const id = (n: number) => `5d0c1f6e-2a3b-4c5d-8e9f-${String(n).padStart(12, '0')}`;
  const big = Array.from({ length: 250 }, (_, n) => id(n));

  function largeService() {
    const supabase = mockSupabase({
      global_persons: {
        rows: big.map((gp, n) =>
          fighter(gp, `Fighter ${String(n).padStart(3, '0')}`, { fightbook_enabled: n < 220 }),
        ),
      },
      fightbook_blocks: { rows: [] },
      events: { rows: [event(EVENT)] },
      persons: { rows: [roster('p-me', EVENT, MARC), ...big.map((gp) => roster(gp, EVENT, gp))] },
      fighter_weapons: { rows: [] },
      tournaments: { rows: [] },
    });
    return { find: new SparFindService(supabase as never, {} as never), supabase };
  }

  it('answers the first 200 askable fighters by name, reading in pieces', async () => {
    const { find, supabase } = largeService();
    const cards = await find.atEvent(MARC, EVENT, undefined, reader);
    expect(cards).toHaveLength(200);
    expect(cards[0]?.fighter.name).toBe('Fighter 000');
    expect(cards[199]?.fighter.name).toBe('Fighter 199');
    const inCalls = ['global_persons', 'fighter_weapons', 'persons'].flatMap((table) =>
      filtersFor(supabase.from, table, 'in'),
    );
    expect(inCalls.length).toBeGreaterThan(0);
    for (const [, values] of inCalls) {
      expect((values as unknown[]).length).toBeLessThanOrEqual(IN_LIST_MAX);
    }
  });
});
