import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { fightBookOnFighters } from './spar-askable';
import { SparFindService } from './spar-find.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const OFF = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
const UNCLAIMED = '4f107e96-1b9d-4e9b-9d99-5f5d7d906e45';
const MERGED = '50218fa7-2cae-4fac-8eaa-606e8ea17f56';
const DELETED = '61329ab8-3dbf-40bd-9fbb-717f9fb28067';
const ERASED = '7243abc9-4ec0-41ce-80cc-8280a0c39178';
const BLOCKED = '8354bcda-5fd1-42df-91dd-9391b1d4a289';
const BLOCKER = '9465cdeb-60e2-43e0-a2ee-a4a2c2e5b39a';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const OTHER_EVENT = 'eeeeeeee-0000-4000-8000-00000000000b';
const DRAFT_EVENT = 'eeeeeeee-0000-4000-8000-00000000000c';
const TEST_EVENT = 'eeeeeeee-0000-4000-8000-00000000000d';
const reader: PublicReader = { userId: ACCOUNT, staff: null };

const live = {
  claimed_by_user_id: ACCOUNT,
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};
const fighter = (id: string, over: Record<string, unknown> = {}) => ({ id, ...live, ...over });
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

const fighters = [
  fighter(MARC),
  fighter(JULIE),
  fighter(PAUL),
  fighter(OFF, { fightbook_enabled: false }),
  fighter(UNCLAIMED, { claimed_by_user_id: null }),
  fighter(MERGED, { merged_into_id: JULIE }),
  fighter(DELETED, { deleted_at: '2026-01-01T00:00:00Z' }),
  fighter(ERASED, { account_deleted_at: '2026-01-01T00:00:00Z' }),
  fighter(BLOCKED),
  fighter(BLOCKER),
];

const events = [
  event(EVENT),
  event(OTHER_EVENT),
  event(DRAFT_EVENT, { status: 'draft' }),
  event(TEST_EVENT, { event_kind: 'test' }),
];

const persons = [
  roster('p-julie', EVENT, JULIE),
  roster('p-off', EVENT, OFF),
  roster('p-unclaimed', EVENT, UNCLAIMED),
  roster('p-none', EVENT, null),
  roster('p-me', EVENT, MARC),
  roster('p-blocked', EVENT, BLOCKED),
  roster('p-blocker', EVENT, BLOCKER),
  roster('p-hidden', EVENT, PAUL),
  roster('p-other', OTHER_EVENT, JULIE),
  roster('p-draft', DRAFT_EVENT, JULIE),
  roster('p-test', TEST_EVENT, JULIE),
];

/** I blocked BLOCKED; BLOCKER blocked me (`theyBlockedMe`), which must change nothing I see. */
function service({ theyBlockedMe = true, insider = false } = {}) {
  const block = (blocker: string, blocked: string) => ({
    blocker_global_person_id: blocker,
    blocked_global_person_id: blocked,
  });
  const supabase = mockSupabase({
    global_persons: { rows: fighters },
    fightbook_blocks: {
      rows: [block(MARC, BLOCKED), ...(theyBlockedMe ? [block(BLOCKER, MARC)] : [])],
    },
    events: { rows: events },
    persons: { rows: persons },
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

const askable = async (target: string, theyBlockedMe = true) =>
  (await service({ theyBlockedMe }).find.askableFighter(MARC, target)).askable;

describe('SparFindService.askableFighter', () => {
  it('says yes for a live, claimed fighter with FightBook on', async () => {
    const { find, supabase } = service();
    expect(await find.askableFighter(MARC, JULIE)).toEqual({ askable: true });
    expect(selectsFor(supabase.from, 'global_persons')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'global_persons', 'in')).toEqual([['id', [JULIE]]]);
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

  it.each([
    ['switched off', OFF],
    ['unclaimed', UNCLAIMED],
    ['merged away', MERGED],
    ['deleted', DELETED],
    ['erased', ERASED],
    ['myself', MARC],
    ['one I blocked', BLOCKED],
  ])('says no for a fighter %s', async (_, target) => {
    expect(await askable(target)).toBe(false);
  });

  it('reads only the blocks I made, never one naming me as blocked', async () => {
    const { find, supabase } = service();
    await find.askableFighter(MARC, BLOCKED);
    expect(selectsFor(supabase.from, 'fightbook_blocks')).toEqual(['blocked_global_person_id']);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'in')).toEqual([]);
  });

  // Ruling 672: whether Julie blocked Marc is never told to Marc, by this answer or any other.
  it('answers the same when the fighter blocked me', async () => {
    const blockedMe = await askable(BLOCKER, true);
    const noBlock = await askable(BLOCKER, false);
    expect(blockedMe).toBe(noBlock);
    expect(blockedMe).toBe(true);
  });
});

describe('SparFindService.askableAtEvent', () => {
  const everyone = [
    'p-julie',
    'p-off',
    'p-unclaimed',
    'p-none',
    'p-me',
    'p-blocked',
    'p-blocker',
    'p-hidden',
    'p-other',
    'p-draft',
    'p-test',
  ];

  it('maps the askable roster rows of that Event, and only those', async () => {
    const { find, supabase } = service();
    expect(await find.askableAtEvent(MARC, EVENT, everyone, reader)).toEqual({
      'p-julie': JULIE,
      'p-blocker': BLOCKER,
    });
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, status, organization_id, event_kind',
    ]);
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
    expect(selectsFor(supabase.from, 'persons')[0]).toBe('id, global_person_id');
    expect(filtersFor(supabase.from, 'persons', 'eq')[0]).toEqual(['event_id', EVENT]);
    expect(filtersFor(supabase.from, 'persons', 'in')[0]).toEqual(['id', everyone]);
  });

  it('skips a roster row with no fighter profile, and the others still answer', async () => {
    const { find, supabase } = service();
    expect(await find.askableAtEvent(MARC, EVENT, ['p-none', 'p-julie'], reader)).toEqual({
      'p-julie': JULIE,
    });
    expect(await find.askableAtEvent(MARC, EVENT, ['p-none'], reader)).toEqual({});
    // The double never matches a null id; PostgREST would cast it to a uuid and fail the answer.
    expect(filtersFor(supabase.from, 'global_persons', 'in')).toEqual([['id', [JULIE]]]);
  });

  it.each([
    ['a draft Event', DRAFT_EVENT, 'p-draft'],
    ['a test Event', TEST_EVENT, 'p-test'],
    ['an unknown Event', 'eeeeeeee-0000-4000-8000-0000000000ff', 'p-julie'],
  ])('answers nothing for %s, though its roster holds an askable fighter', async (_, id, row) => {
    const { find, supabase } = service();
    expect(await find.askableAtEvent(MARC, id, [row], reader)).toEqual({});
    expect(selectsFor(supabase.from, 'persons')).toEqual([]);
  });

  it('leaves out someone entered only in a draft Tournament', async () => {
    const { find } = service();
    expect(await find.askableAtEvent(MARC, EVENT, ['p-julie', 'p-hidden'], reader)).toEqual({
      'p-julie': JULIE,
    });
  });

  // The control for the case above: Paul is askable, so only the draft entry hid him.
  it("shows that entrant to a member of the Event's club", async () => {
    const { find } = service({ insider: true });
    expect(await find.askableAtEvent(MARC, EVENT, ['p-julie', 'p-hidden'], reader)).toEqual({
      'p-julie': JULIE,
      'p-hidden': PAUL,
    });
  });
});

describe('fightBookOnFighters', () => {
  it('reads a roster of 250 in pieces a request line can carry', async () => {
    const ids = [JULIE, ...Array.from({ length: 249 }, (_, i) => `id-${i}`)];
    const { supabase } = service();
    expect([...(await fightBookOnFighters(supabase.service as never, ids))]).toEqual([JULIE]);
    const pieces = filtersFor(supabase.from, 'global_persons', 'in').map(
      (args) => (args[1] as string[]).length,
    );
    expect(pieces).toEqual([IN_LIST_MAX, 250 - IN_LIST_MAX]);
  });
});
