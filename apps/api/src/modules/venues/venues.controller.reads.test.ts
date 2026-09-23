/**
 * Who may read venues.
 *
 * Until 2026-09-23 all four reads resolved no caller at all.
 *
 * - A club's venue catalogue and one venue (address, areas, pistes, and the
 *   names of the Events using each venue, drafts included): any member of the
 *   venue's own organisation, any role (operator ruling 77). A signed-out
 *   caller gets 401 before anything is read.
 * - The venues an Event uses and a Tournament's venue per phase: public, but a
 *   DRAFT Event answers 404 to anyone outside its organisation (ruling 78) —
 *   the rule of the public piste list and the public Tournaments list.
 *
 * Driven through the controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const VENUE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PUBLISHED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const T_DRAFT = '33333333-3333-4333-8333-333333333333';
const T_PUBLISHED = '44444444-4444-4444-8444-444444444444';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let controller: VenuesController;

function venue(id: string, orgId: string, name: string) {
  return {
    id,
    organization_id: orgId,
    name,
    address: `${name} street`,
    venue_areas: [],
    venue_lices: [],
  };
}

beforeEach(() => {
  db = mockSupabase({
    venues: { rows: [venue(VENUE_B, ORG_B, 'Hall B'), venue(VENUE_A, ORG_A, 'Hall A')] },
    events: {
      rows: [
        { id: PUBLISHED, organization_id: ORG_A, status: 'published', name: 'Open', slug: 'open' },
        { id: DRAFT, organization_id: ORG_A, status: 'draft', name: 'Secret', slug: 'secret' },
      ],
    },
    event_venues: {
      rows: [
        { event_id: DRAFT, venue_id: VENUE_A },
        { event_id: PUBLISHED, venue_id: VENUE_A },
      ],
    },
    lices: { rows: [] },
    workshop_sessions: { rows: [] },
    tournaments: {
      rows: [
        // The `events!inner(...)` embed, as PostgREST hands it back.
        { id: T_DRAFT, event_id: DRAFT, events: { status: 'draft', organization_id: ORG_A } },
        {
          id: T_PUBLISHED,
          event_id: PUBLISHED,
          events: { status: 'published', organization_id: ORG_A },
        },
      ],
    },
    tournament_phase_venues: {
      rows: [
        { tournament_id: T_DRAFT, phase_kind: 'pool', venues: { id: VENUE_A, name: 'Hall A' } },
        {
          tournament_id: T_PUBLISHED,
          phase_kind: 'pool',
          venues: { id: VENUE_A, name: 'Hall A' },
        },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: ORG_B, user_id: 'u-owner-b', role: 'owner' },
        { organization_id: ORG_A, user_id: 'u-member-a', role: 'read_only' },
      ],
    },
    platform_roles: { rows: [{ user_id: 'u-padmin', role: 'platform_admin' }] },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
    anon: {
      auth: {
        getUser: vi.fn(async (token: string) => ({ data: { user: { id: token } }, error: null })),
      },
    },
  };
  const service = new VenuesService(supabase as never, new OrganizationsService(supabase as never));
  controller = new VenuesController(service, supabase as never);
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

async function oneAnswer(
  call: (caller?: string) => Promise<unknown>,
  callers: string[],
  type: unknown,
) {
  const answers: unknown[] = [];
  for (const caller of callers) {
    const refusal = await call(caller).catch((error: unknown) => error);
    expect(refusal, caller).toBeInstanceOf(type as never);
    answers.push((refusal as ForbiddenException).getResponse());
  }
  return new Set(answers.map((answer) => JSON.stringify(answer))).size;
}

const idsOf = (rows: unknown) => (rows as { id: string }[]).map((row) => row.id);

describe("a club's venue catalogue (ruling 77)", () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.listForOrg(ORG_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.get(VENUE_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it("refuses an outsider, another club's owner and platform staff the list, with one answer, before reading it", async () => {
    const size = await oneAnswer(
      (caller) => controller.listForOrg(ORG_A, req(caller)),
      ['u-stranger', 'u-owner-b', 'u-padmin'],
      ForbiddenException,
    );
    expect(size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('venues');
  });

  it('lets a read-only member list the club’s venues', async () => {
    await expect(controller.listForOrg(ORG_A, req('u-member-a')).then(idsOf)).resolves.toEqual([
      VENUE_A,
    ]);
  });

  it('checks one venue against its OWN club, not one the caller belongs to', async () => {
    await expect(controller.get(VENUE_A, req('u-member-a'))).resolves.toMatchObject({
      id: VENUE_A,
    });
    await expect(controller.get(VENUE_B, req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.get(VENUE_A, req('u-owner-b'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 404 for a venue that does not exist', async () => {
    await expect(controller.get(NOBODY, req('u-member-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads the deciding column', async () => {
    await controller.listForOrg(ORG_A, req('u-member-a'));
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});

describe("an Event's venues and a Tournament's phase venues (ruling 78)", () => {
  it("shows a published Event's venues to anyone, signed out included", async () => {
    await expect(controller.listForEvent(PUBLISHED, req()).then(idsOf)).resolves.toEqual([VENUE_A]);
    await expect(controller.getTournamentPhaseVenues(T_PUBLISHED, req())).resolves.toMatchObject({
      pool: { id: VENUE_A },
    });
  });

  it('hides a draft Event from everyone outside its club, with one 404, before reading its venues', async () => {
    const lists = await oneAnswer(
      (caller) => controller.listForEvent(DRAFT, req(caller)),
      [undefined as never, 'u-stranger', 'u-owner-b'],
      NotFoundException,
    );
    const phases = await oneAnswer(
      (caller) => controller.getTournamentPhaseVenues(T_DRAFT, req(caller)),
      [undefined as never, 'u-stranger', 'u-owner-b'],
      NotFoundException,
    );
    expect([lists, phases]).toEqual([1, 1]);
    expect(queriedTables(db.from)).not.toContain('event_venues');
    expect(queriedTables(db.from)).not.toContain('tournament_phase_venues');
  });

  it('refuses a draft by the Tournament id it was asked for, never the hidden Event id', async () => {
    const refusal = await controller
      .getTournamentPhaseVenues(T_DRAFT, req('u-stranger'))
      .catch((error: unknown) => error);
    const message = JSON.stringify((refusal as NotFoundException).getResponse());
    expect(message).toContain(T_DRAFT);
    expect(message).not.toContain(DRAFT);
  });

  it("shows a draft Event's venues to a member of its club", async () => {
    await expect(controller.listForEvent(DRAFT, req('u-member-a')).then(idsOf)).resolves.toEqual([
      VENUE_A,
    ]);
    await expect(
      controller.getTournamentPhaseVenues(T_DRAFT, req('u-member-a')),
    ).resolves.toMatchObject({ pool: { id: VENUE_A } });
  });

  it('answers no venues for a Tournament that does not exist, as before', async () => {
    await expect(controller.getTournamentPhaseVenues(NOBODY, req())).resolves.toEqual({
      pool: null,
      swiss: null,
      bracket: null,
    });
  });

  it('reads each deciding column', async () => {
    await controller.getTournamentPhaseVenues(T_DRAFT, req('u-member-a'));
    expect(selectsFor(db.from, 'tournaments')).toEqual(['events!inner(status, organization_id)']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
    await controller.listForEvent(DRAFT, req('u-member-a'));
    expect(selectsFor(db.from, 'events')).toEqual(['status, organization_id']);
  });
});
