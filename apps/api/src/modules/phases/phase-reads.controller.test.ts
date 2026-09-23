/**
 * Who may read a Tournament's Pools, bouts, scores, unplaced fighters and bracket.
 *
 * Until 2026-09-23 the five reads resolved no caller at all: anyone who knew a
 * Tournament id got the whole roster, every bout's referee crew and the bracket,
 * a draft Event's included. Only the organiser pages call them — spectators
 * read the public slug routes — so they now need a member of the Tournament's
 * own club, any role (operator ruling 79). A signed-out caller gets 401 before
 * anything is read. Even a published Event's Tournament is refused to a
 * stranger: this is a member bar, not a draft gate.
 *
 * Driven through the controller and the real membership check over seeded
 * tables; the Pool reads themselves are stubbed.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhaseReadsController } from './phase-reads.controller';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PUBLISHED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T_DRAFT = '33333333-3333-4333-8333-333333333333';
const T_PUBLISHED = '44444444-4444-4444-8444-444444444444';
const T_B = '55555555-5555-4555-8555-555555555555';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let controller: PhaseReadsController;
let phases: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: PUBLISHED, organization_id: ORG_A, status: 'published' },
        { id: DRAFT, organization_id: ORG_A, status: 'draft' },
        { id: EVENT_B, organization_id: ORG_B, status: 'published' },
      ],
    },
    tournaments: {
      rows: [
        { id: T_DRAFT, event_id: DRAFT },
        { id: T_PUBLISHED, event_id: PUBLISHED },
        { id: T_B, event_id: EVENT_B },
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
  phases = {
    listTournamentPools: vi.fn(async (id: string) => ({ read: 'pools', id })),
    listPoolsWithMatches: vi.fn(async (id: string) => ({ read: 'pools-with-matches', id })),
    listMatchScores: vi.fn(async (id: string) => ({ read: 'match-scores', id })),
    listUnassignedFighters: vi.fn(async (id: string) => ({ read: 'unassigned', id })),
    getTournamentBracket: vi.fn(async (id: string) => ({ read: 'bracket', id })),
  };
  controller = new PhaseReadsController(
    phases as never,
    supabase as never,
    new OrganizationsService(supabase as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

/** Each route, with the service read it must reach — and only after the check. */
const ROUTES = [
  ['listPools', 'listTournamentPools', 'pools'],
  ['listPoolsWithMatches', 'listPoolsWithMatches', 'pools-with-matches'],
  ['listMatchScores', 'listMatchScores', 'match-scores'],
  ['listUnassignedFighters', 'listUnassignedFighters', 'unassigned'],
  ['getBracket', 'getTournamentBracket', 'bracket'],
] as const;

function call(route: (typeof ROUTES)[number][0], tournamentId: string, caller?: string) {
  const handler = controller[route] as (id: string, request: never) => Promise<unknown>;
  return handler.call(controller, tournamentId, req(caller));
}

function nothingRead() {
  for (const read of Object.values(phases)) expect(read).not.toHaveBeenCalled();
}

describe.each(ROUTES)('%s (ruling 79)', (route, read, marker) => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(call(route, T_PUBLISHED)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
    nothingRead();
  });

  it("refuses an outsider, another club's owner and platform staff a PUBLISHED Event's Tournament, with one answer", async () => {
    const answers = new Set<string>();
    for (const caller of ['u-stranger', 'u-owner-b', 'u-padmin']) {
      const refusal = await call(route, T_PUBLISHED, caller).catch((error: unknown) => error);
      expect(refusal, caller).toBeInstanceOf(ForbiddenException);
      answers.add(JSON.stringify((refusal as ForbiddenException).getResponse()));
    }
    expect(answers.size).toBe(1);
    nothingRead();
  });

  it("lets a read-only member of the club read its Tournaments, a draft Event's included", async () => {
    for (const tournamentId of [T_PUBLISHED, T_DRAFT]) {
      await expect(call(route, tournamentId, 'u-member-a')).resolves.toEqual({
        read: marker,
        id: tournamentId,
      });
    }
    expect(phases[read]).toHaveBeenCalledTimes(2);
  });

  it('checks the Tournament against its OWN club, not one the caller belongs to', async () => {
    await expect(call(route, T_B, 'u-member-a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call(route, T_PUBLISHED, 'u-owner-b')).rejects.toBeInstanceOf(ForbiddenException);
    nothingRead();
  });

  it('answers 404 for a Tournament that does not exist, like the other member reads', async () => {
    await expect(call(route, NOBODY, 'u-member-a')).rejects.toBeInstanceOf(NotFoundException);
    nothingRead();
  });

  it('reads each deciding column', async () => {
    await call(route, T_PUBLISHED, 'u-member-a');
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id']);
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
