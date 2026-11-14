import { ForbiddenException, Logger, type HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { IN_LIST_MAX, READ_PAGE } from '../../common/postgrest-in-list';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  supabaseChain,
} from '../../common/testing/supabase-chain';
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

const NOW = new Date('2026-05-23T14:00:00Z');
const freeRow = (gp: string, eventId: string, until: string) => ({
  global_person_id: gp,
  event_id: eventId,
  until,
});
const freeNowRows = [
  freeRow(BLOCKER, EVENT, '2026-05-23T14:30:00.000Z'),
  freeRow(JULIE, OTHER_EVENT, '2026-05-23T14:30:00.000Z'),
  freeRow(JULIE, EVENT, '2026-05-23T13:59:00.000Z'),
  freeRow(BLOCKED, EVENT, '2026-05-23T14:30:00.000Z'),
];

function service({ insider = false } = {}) {
  const supabase = mockSupabase({
    global_persons: { rows: fighters },
    // I blocked Charlie; Bravo blocked me, which must change nothing I see (ruling 672).
    fightbook_blocks: { rows: [block(MARC, BLOCKED), block(BLOCKER, MARC)] },
    // Marc hearted Julie; Julie hearted Bravo, which Marc must not see.
    fightbook_favourites: {
      rows: [
        { owner_global_person_id: MARC, favourite_global_person_id: JULIE },
        { owner_global_person_id: JULIE, favourite_global_person_id: BLOCKER },
      ],
    },
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
    // Bravo is free here until 14:30. Julie's rows must not count: one is another Event's, one is
    // past its time. Charlie is free here too, but Marc blocked him.
    fightbook_free_now: { rows: freeNowRows },
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
  it('lists the askable fighters on that Event, the free ones first, then by name ignoring case', async () => {
    const { find } = service();
    expect(await find.atEvent(MARC, EVENT, undefined, reader, NOW)).toEqual([
      {
        fighter: { globalPersonId: BLOCKER, name: 'Bravo Fighter', photoUrl: null, club: null },
        weapons: [],
        favourite: false,
        freeNow: true,
      },
      {
        fighter: { globalPersonId: JULIE, name: 'alpha Fighter', photoUrl: null, club: 'Club A' },
        weapons: ['Longsword', 'Sabre', 'Rapier'],
        favourite: true,
        freeNow: false,
      },
    ]);
  });

  it('reads the free-now rows of the listed fighters at this Event, still running', async () => {
    const { find, supabase } = service();
    await find.atEvent(MARC, EVENT, undefined, reader, NOW);
    expect(selectsFor(supabase.from, 'fightbook_free_now')).toEqual(['global_person_id']);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'gt')).toEqual([
      ['until', NOW.toISOString()],
    ]);
    // Only the fighters the roster, the blocks and the switch left in: never Charlie (blocked).
    const [[, asked]] = filtersFor(supabase.from, 'fightbook_free_now', 'in') as [
      [string, string[]],
    ];
    expect([...asked].sort()).toEqual([BLOCKER, JULIE].sort());
  });

  // The badge is an add-on to a page the fighter needs: lose the badge, keep the list.
  // A failed read is logged by its code or kind: a database message can echo the ids it was given.
  it.each([
    [
      'answered with an error',
      () => supabaseChain({ data: null, error: { code: '22P02', message: `bad "${MARC}"` } }),
      'the free-now marks are unreadable: invalid_text_representation (22P02)',
    ],
    [
      'thrown',
      () => {
        throw new TypeError(`fetch failed for ${MARC}`);
      },
      'TypeError',
    ],
  ])(
    'still lists the fighters, with no badge, when the free-now read is %s',
    async (_, read, why) => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { find, supabase } = service();
      const original = supabase.from.getMockImplementation()!;
      supabase.from.mockImplementation((table: string) =>
        table === 'fightbook_free_now' ? read() : original(table),
      );
      const cards = await find.atEvent(MARC, EVENT, undefined, reader, NOW);
      expect(cards.map((card) => [card.fighter.name, card.freeNow])).toEqual([
        ['alpha Fighter', false],
        ['Bravo Fighter', false],
      ]);
      expect(error.mock.calls).toEqual([[`Free-now badge left off: ${why}`]]);
      error.mockRestore();
    },
  );

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
      fightbook_favourites: { rows: [] },
      events: { rows: [event(EVENT)] },
      persons: { rows: [roster('p-me', EVENT, MARC), ...big.map((gp) => roster(gp, EVENT, gp))] },
      fighter_weapons: { rows: [] },
      tournaments: { rows: [] },
      fightbook_free_now: { rows: [] },
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

// PostgREST cuts a read at its max rows without a word: the roster is read page by page by id.
describe('SparFindService.atEvent, a roster longer than one read', () => {
  // 1000 rows with no fighter on FightBook sort first by id; Julie's row is on the second page.
  const fillers = Array.from({ length: READ_PAGE }, (_, n) =>
    roster(`p-${String(n).padStart(4, '0')}`, EVENT, `gp-${n}`),
  );

  it('reads every page until an empty one, so the fighter on page two is listed', async () => {
    const supabase = mockSupabase({
      global_persons: { rows: fighters },
      fightbook_blocks: { rows: [] },
      fightbook_favourites: { rows: [] },
      events: { rows: [event(EVENT)] },
      persons: { rows: [...fillers, roster('p-julie', EVENT, JULIE), roster('p-me', EVENT, MARC)] },
      fighter_weapons: { rows: [] },
      tournaments: { rows: [] },
      fightbook_free_now: { rows: [] },
    });
    const find = new SparFindService(supabase as never, {} as never);
    const cards = await find.atEvent(MARC, EVENT, undefined, reader);
    expect(cards.map((card) => card.fighter.globalPersonId)).toEqual([JULIE]);
    const rosterReads = selectsFor(supabase.from, 'persons').filter(
      (select) => select === 'id, global_person_id',
    );
    expect(rosterReads).toHaveLength(3);
    expect(filtersFor(supabase.from, 'persons', 'order')).toEqual([['id'], ['id'], ['id']]);
    expect(filtersFor(supabase.from, 'persons', 'gt')).toEqual([
      ['id', 'p-0999'],
      ['id', 'p-me'],
    ]);
    expect(
      filtersFor(supabase.from, 'persons', 'limit').filter(([count]) => count === READ_PAGE),
    ).toHaveLength(3);
  });
});
