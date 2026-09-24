/**
 * The events module's two public reads by id: a Tournament's match config (the
 * rules the referee's pad draws) and an Event's theme (rulings 81-83, 95).
 *
 * Until 2026-09-24 both answered anyone for any id, a draft's included, and the
 * match config answered an id that matched no Tournament with the TF_v1 defaults
 * — a pad whose read failed stored those as fresh and scored with the wrong
 * buttons. Now an unknown id is a 404, and a Tournament hidden from the caller
 * (a DRAFT Event, or a Tournament not published, running or completed) answers
 * exactly the same 404 (ruling 95). A draft Event's theme answers exactly as an
 * unknown Event's. A member of the Event's club and an ACTIVE staff session of
 * the same Event still read both: the pad on a test day is such a session.
 *
 * Everything runs for real over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventThemesService } from './event-themes.service';
import { EventsController } from './events.controller';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** A published Event whose own Tournaments are not: EVENT_OPEN's staff are strangers here. */
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_UNKNOWN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const RUNNING = '11111111-1111-4111-8111-111111111111';
const PUBLISHED = '22222222-2222-4222-8222-222222222222';
const COMPLETED = '33333333-3333-4333-8333-333333333333';
const IN_DRAFT_EVENT = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';
const ARCHIVED = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const VISIBLE = [RUNNING, PUBLISHED, COMPLETED];
const HIDDEN = [IN_DRAFT_EVENT, DRAFT, ARCHIVED];

const events = {
  [EVENT_OPEN]: { id: EVENT_OPEN, status: 'published', organization_id: 'org-a' },
  [EVENT_DRAFT]: { id: EVENT_DRAFT, status: 'draft', organization_id: 'org-a' },
  [EVENT_B]: { id: EVENT_B, status: 'published', organization_id: 'org-a' },
};

/** Each Tournament carries its own lock delay, so an answer names the row it came from. */
function tournament(id: string, status: string, eventId: keyof typeof events, delay: number) {
  return {
    id,
    status,
    ruleset_code: 'TF_v1',
    ruleset_config: {},
    scoring_config_json: null,
    lock_config_json: { autoLockDelayMinutes: delay },
    events: events[eventId],
  };
}

const DELAY: Record<string, number> = {
  [RUNNING]: 11,
  [PUBLISHED]: 12,
  [COMPLETED]: 13,
  [IN_DRAFT_EVENT]: 14,
  [DRAFT]: 15,
  [ARCHIVED]: 16,
};

const MEMBERS = [
  { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
  { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
];
const STAFF = [
  { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
  { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
  { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
  { id: 'staff-b', event_id: EVENT_B, status: 'active' },
];

let db: ReturnType<typeof mockSupabase>;
let controller: EventsController;

function build(tournaments: Parameters<typeof mockSupabase>[0][string]) {
  db = mockSupabase({
    tournaments,
    events: {
      rows: Object.values(events).map((e) => ({ ...e, logo_url: `logo-${e.id}` })),
    },
    themes: {
      rows: Object.values(events).map((e) => ({
        id: `theme-${e.id}`,
        event_id: e.id,
        hero_image_url: `hero-${e.id}`,
      })),
    },
    organization_members: { rows: MEMBERS },
    event_staff_accounts: { rows: STAFF },
  });
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(supabase as never);
  controller = new EventsController(
    {} as never,
    supabase as never,
    new EventThemesService(supabase as never, orgs, {} as never),
    {} as never,
    orgs,
  );
}

beforeEach(() =>
  build({
    rows: [
      tournament(RUNNING, 'running', EVENT_OPEN, DELAY[RUNNING]!),
      tournament(PUBLISHED, 'published', EVENT_OPEN, DELAY[PUBLISHED]!),
      tournament(COMPLETED, 'completed', EVENT_OPEN, DELAY[COMPLETED]!),
      tournament(IN_DRAFT_EVENT, 'running', EVENT_DRAFT, DELAY[IN_DRAFT_EVENT]!),
      tournament(DRAFT, 'draft', EVENT_B, DELAY[DRAFT]!),
      tournament(ARCHIVED, 'archived', EVENT_B, DELAY[ARCHIVED]!),
    ],
  }),
);

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

/** The refusal's status and body, with the id blanked so two ids compare. */
async function refusal(call: Promise<unknown>, id: string): Promise<string> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected a refusal').toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return JSON.stringify({ status: http.getStatus(), body: http.getResponse() }).replaceAll(
    id,
    '<id>',
  );
}

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

/** The active staff session of the hidden Tournament's own Event. */
const staffOf = (id: string) =>
  id === IN_DRAFT_EVENT
    ? { staffId: 'staff-draft', eventId: EVENT_DRAFT }
    : { staffId: 'staff-b', eventId: EVENT_B };

describe('GET tournaments/:id/match-config (rulings 81-83, 95)', () => {
  const config = (id: string, caller?: Caller) => controller.getMatchConfig(id, req(caller));

  it('answers an unknown Tournament with a 404 in its own words, not the TF_v1 defaults', async () => {
    await expect(config(UNKNOWN)).rejects.toThrow(`Tournament ${UNKNOWN} not found`);
    expect(await refusal(config(UNKNOWN), UNKNOWN)).toBe(
      JSON.stringify({
        status: 404,
        body: { message: 'Tournament <id> not found', error: 'Not Found', statusCode: 404 },
      }),
    );
  });

  it("gives a published, running or completed Tournament's own config to anyone, signed out included", async () => {
    for (const id of VISIBLE) {
      expect((await config(id)).lockConfig.autoLockDelayMinutes, id).toBe(DELAY[id]);
      expect((await config(id, { user: 'u-stranger' })).lockConfig.autoLockDelayMinutes).toBe(
        DELAY[id],
      );
    }
  });

  it('answers a hidden Tournament to outsiders exactly as an unknown one', async () => {
    const unknown = await refusal(config(UNKNOWN), UNKNOWN);
    for (const id of HIDDEN) {
      for (const caller of STRANGERS) {
        expect(await refusal(config(id, caller), id), `${id} ${JSON.stringify(caller)}`).toBe(
          unknown,
        );
      }
    }
  });

  it("gives a hidden Tournament's own config to a club member and to the Event's active staff", async () => {
    const insiders = (id: string): Caller[] => [
      { user: 'u-member' },
      { staff: staffOf(id) },
      // The Event's pad, where a stranger once signed in.
      { user: 'u-stranger', staff: staffOf(id) },
    ];
    for (const id of HIDDEN) {
      for (const caller of insiders(id)) {
        expect(
          (await config(id, caller)).lockConfig.autoLockDelayMinutes,
          `${id} ${JSON.stringify(caller)}`,
        ).toBe(DELAY[id]);
      }
    }
  });

  it("reads everything from one Tournament row, and a projector's read costs nothing more", async () => {
    await config(RUNNING);
    expect(queriedTables(db.from)).toEqual(['tournaments']);
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      'ruleset_code, ruleset_config, scoring_config_json, lock_config_json, status, events!inner(id, status, organization_id, event_kind)',
    ]);
  });

  it('fails a failed read loudly: never a 404, never the defaults', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    const error = await config(RUNNING).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpException);
    expect((error as Error).message).toMatch(/^match-config read failed: connection reset$/);
  });
});

describe('GET events/:eventId/theme (rulings 81-83)', () => {
  const theme = (id: string, caller?: Caller) => controller.getTheme(id, req(caller));

  it("gives a published Event's own theme to anyone, signed out included", async () => {
    expect(await theme(EVENT_OPEN)).toEqual({
      id: `theme-${EVENT_OPEN}`,
      eventId: EVENT_OPEN,
      logoUrl: `logo-${EVENT_OPEN}`,
      heroImageUrl: `hero-${EVENT_OPEN}`,
    });
  });

  it('answers an unknown Event with a 404 in its own words', async () => {
    expect(await refusal(theme(EVENT_UNKNOWN), EVENT_UNKNOWN)).toBe(
      JSON.stringify({
        status: 404,
        body: { message: 'Event <id> not found', error: 'Not Found', statusCode: 404 },
      }),
    );
  });

  it("answers a draft Event's theme to outsiders exactly as an unknown Event", async () => {
    const unknown = await refusal(theme(EVENT_UNKNOWN), EVENT_UNKNOWN);
    for (const caller of STRANGERS) {
      expect(await refusal(theme(EVENT_DRAFT, caller), EVENT_DRAFT), JSON.stringify(caller)).toBe(
        unknown,
      );
    }
  });

  it("gives a draft Event's own theme to a club member and to the Event's active staff", async () => {
    for (const caller of [
      { user: 'u-member' },
      { staff: staffOf(IN_DRAFT_EVENT) },
      { user: 'u-stranger', staff: staffOf(IN_DRAFT_EVENT) },
    ]) {
      expect(await theme(EVENT_DRAFT, caller)).toMatchObject({
        eventId: EVENT_DRAFT,
        heroImageUrl: `hero-${EVENT_DRAFT}`,
      });
    }
  });

  it("reads the Event's status with its logo, and a published Event costs no membership read", async () => {
    await theme(EVENT_OPEN, { user: 'u-stranger' });
    expect(selectsFor(db.from, 'events')).toEqual([
      'id, organization_id, logo_url, status, event_kind',
    ]);
    expect(queriedTables(db.from)).toEqual(['events', 'themes']);
  });
});
