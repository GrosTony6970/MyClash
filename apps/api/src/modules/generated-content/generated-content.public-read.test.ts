/**
 * The public read of published AI content (`GET public/generated-content/:type/:id`).
 *
 * Until 2026-09-24 it read any `content_type` string and asked nothing about the
 * entity: a published recap of a Tournament that is not public (or of a draft
 * Event) went to anyone holding the id, and so did the published insight of a
 * fighter whose profile is gone (merged away, or erased). Now each content type
 * decides who may read its entity's published content. A hidden Tournament
 * answers an outsider exactly like one with nothing published (`null`, rulings
 * 81-83); a member of its club and an ACTIVE staff session of its Event still
 * read it. A merged or erased fighter answers `null`, as their profile 404s. An
 * unknown type and a type that is never published answer `null` too.
 *
 * Driven through the controller, the real service and the real content types
 * over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PublicGeneratedContentController } from './generated-content.controller';
import { GeneratedContentService } from './generated-content.service';
import { FighterInsightType } from './types/fighter-insight.type';
import { OrganizerContentType } from './types/organizer-content.type';
import { TournamentRecapType } from './types/tournament-recap.type';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const T_OPEN = '44444444-4444-4444-8444-444444444444';
const T_IN_DRAFT_EVENT = '55555555-5555-4555-8555-555555555555';
const T_DRAFT = '66666666-6666-4666-8666-666666666666';
const GP_LIVE = '77777777-7777-4777-8777-777777777777';
const GP_ERASED = '88888888-8888-4888-8888-888888888888';
const GP_MERGED = 'abababab-abab-4bab-8bab-abababababab';
const NOBODY = '99999999-9999-4999-8999-999999999999';

const EVENTS = {
  [EVENT_OPEN]: { id: EVENT_OPEN, organization_id: ORG_A, status: 'published' },
  [EVENT_DRAFT]: { id: EVENT_DRAFT, organization_id: ORG_A, status: 'draft' },
  [EVENT_B]: { id: EVENT_B, organization_id: ORG_A, status: 'published' },
};
const tournament = (id: string, status: string, eventId: keyof typeof EVENTS) => ({
  id,
  status,
  events: EVENTS[eventId],
});
const published = (type: string, id: string) => ({
  content_type: type,
  entity_id: id,
  locale: 'en',
  content: `published ${type} of ${id}`,
  status: 'published',
  model: null,
  generated_at: '2026-09-01T10:00:00Z',
  published_at: '2026-09-01T11:00:00Z',
});
const LIVE = { deleted_at: null, merged_into_id: null, account_deleted_at: null };

const TABLES: Record<string, TableSeed> = {
  ai_generated_content: {
    rows: [
      published('tournament_recap', T_OPEN),
      published('tournament_recap', T_IN_DRAFT_EVENT),
      published('tournament_recap', T_DRAFT),
      published('fighter_insight', GP_LIVE),
      published('fighter_insight', GP_ERASED),
      published('fighter_insight', GP_MERGED),
      // Never publishable, but a row can still say so: the type decides, not the row.
      published('organizer_content', EVENT_OPEN),
    ],
  },
  tournaments: {
    rows: [
      tournament(T_OPEN, 'completed', EVENT_OPEN),
      tournament(T_IN_DRAFT_EVENT, 'completed', EVENT_DRAFT),
      tournament(T_DRAFT, 'draft', EVENT_B),
    ],
  },
  global_persons: {
    rows: [
      { id: GP_LIVE, ...LIVE },
      { id: GP_ERASED, ...LIVE, account_deleted_at: '2026-09-02T00:00:00Z' },
      { id: GP_MERGED, ...LIVE, merged_into_id: GP_LIVE },
    ],
  },
  organization_members: {
    rows: [{ organization_id: ORG_A, user_id: 'u-member', role: 'read_only' }],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
    ],
  },
};

let db: ReturnType<typeof mockSupabase>;
let controller: PublicGeneratedContentController;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(supabase as never);
  const types = [
    new TournamentRecapType(supabase as never, {} as never, orgs),
    new OrganizerContentType(supabase as never, orgs),
    new FighterInsightType(supabase as never, {} as never),
  ];
  const service = new GeneratedContentService(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    types,
  );
  controller = new PublicGeneratedContentController(service);
}

beforeEach(() => build());

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

/** A request as the AuthGuard leaves it: the login wins the identity, the staff cookie is kept beside it. */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

const read = (type: string, id: string, caller?: Caller) =>
  controller.getPublished(type, id, req(caller), 'en');

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
];

describe('public generated content: a Tournament recap (rulings 81-83)', () => {
  it('shows a public Tournament recap to anyone, signed out included', async () => {
    expect(await read('tournament_recap', T_OPEN)).toMatchObject({
      content: `published tournament_recap of ${T_OPEN}`,
    });
  });

  it('answers an unknown Tournament with null', async () => {
    expect(await read('tournament_recap', NOBODY)).toBeNull();
  });

  it.each(STRANGERS)(
    "answers a hidden Tournament's recap to outsider %j exactly like an unknown one",
    async (caller) => {
      for (const id of [T_IN_DRAFT_EVENT, T_DRAFT]) {
        expect(await read('tournament_recap', id, caller)).toBeNull();
      }
    },
  );

  it("shows a hidden recap to a club member and to its own Event's active staff", async () => {
    expect(await read('tournament_recap', T_DRAFT, { user: 'u-member' })).not.toBeNull();
    const ownStaff = { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } };
    expect(await read('tournament_recap', T_IN_DRAFT_EVENT, ownStaff)).not.toBeNull();
  });

  it('reads the deciding columns, and a signed-out read costs no membership read', async () => {
    await read('tournament_recap', T_DRAFT);
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      'status, events!inner(id, status, organization_id, event_kind)',
    ]);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });
});

describe("public generated content: a fighter's insight", () => {
  it("shows a live fighter's insight to anyone", async () => {
    expect(await read('fighter_insight', GP_LIVE)).toMatchObject({
      content: `published fighter_insight of ${GP_LIVE}`,
    });
  });

  it.each([
    ['an erased', GP_ERASED],
    ['a merged-away', GP_MERGED],
    ['an unknown', NOBODY],
  ])('answers the insight of %s fighter with null, as their profile 404s', async (_l, id) => {
    expect(await read('fighter_insight', id)).toBeNull();
  });

  it('reads exactly the columns the profile decides on', async () => {
    await read('fighter_insight', GP_LIVE);
    expect(selectsFor(db.from, 'global_persons')).toEqual([
      'deleted_at, merged_into_id, account_deleted_at',
    ]);
  });
});

describe('public generated content: the type decides', () => {
  it.each([
    ['an unknown type', 'nope', EVENT_OPEN],
    ['a type that is never published', 'organizer_content', EVENT_OPEN],
  ])('answers %s with null, and reads nothing', async (_l, type, id) => {
    expect(await read(type, id)).toBeNull();
    expect(queriedTables(db.from)).toEqual([]);
  });
});

describe('public generated content: a failed read', () => {
  const FAILED = { data: null, error: { message: 'boom' } };
  it.each([
    ['tournaments', 'tournament_recap', T_OPEN],
    ['global_persons', 'fighter_insight', GP_LIVE],
    ['ai_generated_content', 'tournament_recap', T_OPEN],
  ])('fails a failed %s read loudly, never as "nothing published"', async (table, type, id) => {
    build({ [table]: FAILED });
    const call = read(type, id);
    await expect(call).rejects.toThrow('read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
