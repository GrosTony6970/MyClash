/**
 * Who may read a league's join requests, the leagues a Tournament can ask to
 * join, and a league's groups.
 *
 * Until 2026-09-23 all four reads resolved no caller at all: anyone read every
 * draft league, any league's groups, and any league's join requests (messages,
 * review notes, account ids).
 *
 * - join requests: the league's managers (platform admin, a direct league
 *   admin/owner, or an admin of a club holding an admin/owner role on it) —
 *   the bar of `review` and of every other league-management route.
 * - the attach list: a published league to anyone signed in; a draft only to
 *   its own managers (operator ruling 72) and to an admin of a club holding any
 *   role in it, member included (ruling 76) — not to that club's other members.
 * - groups, the picker's route: the attach list's rule, so the picker never
 *   sees a league its list hides; the manage page's route: the managers
 *   (ruling 73), the bar the group writes use.
 *
 * A signed-out caller gets 401 before anything is read. Driven through the
 * controllers and the real services over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { LeagueMembershipRequestsController } from './league-membership-requests.controller';
import { LeagueMembershipRequestsService } from './league-membership-requests.service';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

const PUBLISHED = '11111111-1111-4111-8111-111111111111';
const DRAFT_A = '22222222-2222-4222-8222-222222222222';
const DRAFT_B = '33333333-3333-4333-8333-333333333333';
const ARCHIVED = '44444444-4444-4444-8444-444444444444';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let leagues: LeaguesController;
let requests: LeagueMembershipRequestsController;

function league(id: string, status: string, visible: boolean) {
  return { id, name: id.slice(0, 4), status, public_visibility: visible, season_year: 2026 };
}

beforeEach(() => {
  db = mockSupabase({
    leagues: {
      rows: [
        league(DRAFT_B, 'draft', false),
        league(PUBLISHED, 'published', true),
        league(DRAFT_A, 'draft', false),
        league(ARCHIVED, 'archived', false),
      ],
    },
    // u-league-admin manages DRAFT_A directly; u-org-admin manages DRAFT_B
    // through Club X, which holds an admin role on it.
    league_user_roles: {
      rows: [{ league_id: DRAFT_A, user_id: 'u-league-admin', role: 'admin' }],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-x', user_id: 'u-org-admin', role: 'admin' },
        { organization_id: 'org-x', user_id: 'u-org-editor', role: 'editor' },
        { organization_id: 'org-y', user_id: 'u-club-admin', role: 'admin' },
        { organization_id: 'org-y', user_id: 'u-club-editor', role: 'editor' },
      ],
    },
    league_organization_roles: {
      rows: [
        { id: 'lor-1', league_id: DRAFT_B, organization_id: 'org-x', role: 'admin' },
        // Club Y is a plain MEMBER of DRAFT_A: its admin may attach, not manage.
        { id: 'lor-2', league_id: DRAFT_A, organization_id: 'org-y', role: 'member' },
      ],
    },
    platform_roles: {
      rows: [
        { user_id: 'u-padmin', role: 'platform_admin' },
        { user_id: 'u-viewer', role: 'platform_viewer' },
      ],
    },
    league_groups: {
      rows: [
        { id: 'g-pub', league_id: PUBLISHED, name: 'Open', sort_order: 0 },
        { id: 'g-draft', league_id: DRAFT_A, name: 'Women', sort_order: 0 },
      ],
    },
    league_membership_requests: {
      rows: [
        { id: 'r-a', league_id: DRAFT_A, organization_id: 'org-y', status: 'requested' },
        { id: 'r-pub', league_id: PUBLISHED, organization_id: 'org-y', status: 'requested' },
      ],
    },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  const service = new LeaguesService(supabase as never, {} as never, {} as never);
  leagues = new LeaguesController(service, supabase as never);
  requests = new LeagueMembershipRequestsController(
    new LeagueMembershipRequestsService(supabase as never, {} as never),
    service,
    supabase as never,
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

const idsOf = (rows: unknown) => (rows as { id: string }[]).map((row) => row.id).sort();

async function refusals(call: (caller: string) => Promise<unknown>, callers: string[]) {
  const answers: unknown[] = [];
  for (const caller of callers) {
    const refusal = await call(caller).catch((error: unknown) => error);
    expect(refusal, caller).toBeInstanceOf(ForbiddenException);
    answers.push((refusal as ForbiddenException).getResponse());
  }
  return new Set(answers.map((answer) => JSON.stringify(answer)));
}

/** Everyone who may neither manage DRAFT_A nor attach to it. */
const NOT_MANAGERS_OF_A = [
  'u-stranger',
  'u-org-admin',
  'u-org-editor',
  'u-viewer',
  'u-club-editor',
];
/** Admin of a club that is a plain member of DRAFT_A: attaches, never manages. */
const MEMBER_CLUB_ADMIN = 'u-club-admin';

describe('league join requests (listByLeague)', () => {
  const list = (leagueId: string, caller?: string) =>
    requests.listByLeague(leagueId, undefined, req(caller));

  it('refuses a caller with no token, before any read', async () => {
    await expect(list(DRAFT_A)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('refuses everyone who does not manage the league, with one answer, before reading its requests', async () => {
    const answers = await refusals(
      (caller) => list(DRAFT_A, caller),
      [...NOT_MANAGERS_OF_A, MEMBER_CLUB_ADMIN],
    );
    expect(answers.size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('league_membership_requests');
  });

  it("lets the league's managers read its requests, and only that league's", async () => {
    await expect(list(DRAFT_A, 'u-league-admin').then(idsOf)).resolves.toEqual(['r-a']);
    await expect(list(DRAFT_B, 'u-org-admin')).resolves.toEqual([]);
    await expect(list(PUBLISHED, 'u-padmin').then(idsOf)).resolves.toEqual(['r-pub']);
  });

  it('checks the league the route names, not one the caller manages', async () => {
    await expect(list(DRAFT_B, 'u-league-admin')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(list(DRAFT_A, 'u-org-admin')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads each deciding column', async () => {
    await list(DRAFT_B, 'u-org-admin');
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'platform_roles')).toEqual(['role']);
    expect(selectsFor(db.from, 'league_user_roles')).toEqual(['role']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['*']);
    expect(selectsFor(db.from, 'league_organization_roles')).toEqual(['id']);
  });
});

describe('leagues a Tournament can ask to join (listAttachable)', () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(leagues.listAttachable(req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('shows anyone signed in the published leagues and no draft', async () => {
    for (const caller of ['u-stranger', 'u-org-editor', 'u-viewer', 'u-club-editor']) {
      await expect(leagues.listAttachable(req(caller)).then(idsOf), caller).resolves.toEqual([
        PUBLISHED,
      ]);
    }
  });

  it('adds each draft for its own managers only (ruling 72)', async () => {
    await expect(leagues.listAttachable(req('u-league-admin')).then(idsOf)).resolves.toEqual(
      [PUBLISHED, DRAFT_A].sort(),
    );
    await expect(leagues.listAttachable(req('u-org-admin')).then(idsOf)).resolves.toEqual(
      [PUBLISHED, DRAFT_B].sort(),
    );
    await expect(leagues.listAttachable(req('u-padmin')).then(idsOf)).resolves.toEqual(
      [PUBLISHED, DRAFT_A, DRAFT_B].sort(),
    );
  });

  it('adds a draft for an admin of a club that is a plain member of it (ruling 76)', async () => {
    await expect(leagues.listAttachable(req(MEMBER_CLUB_ADMIN)).then(idsOf)).resolves.toEqual(
      [PUBLISHED, DRAFT_A].sort(),
    );
  });

  it('reads each deciding column', async () => {
    await leagues.listAttachable(req(MEMBER_CLUB_ADMIN));
    expect(selectsFor(db.from, 'leagues')).toEqual(['*']);
    expect(selectsFor(db.from, 'league_organization_roles')).toContain('league_id');
  });
});

describe("a league's groups for the attach picker (listLeagueGroupsPublic)", () => {
  const groups = (leagueId: string, caller?: string) =>
    leagues.listLeagueGroupsPublic(leagueId, req(caller));

  it('refuses a caller with no token, before any read', async () => {
    await expect(groups(PUBLISHED)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it("shows a published league's groups to anyone signed in", async () => {
    await expect(groups(PUBLISHED, 'u-stranger').then(idsOf)).resolves.toEqual(['g-pub']);
  });

  it("refuses a draft league's groups to everyone who does not manage it, with one answer", async () => {
    const answers = await refusals((caller) => groups(DRAFT_A, caller), NOT_MANAGERS_OF_A);
    expect(answers.size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('league_groups');
  });

  it("refuses an archived league's groups too: only a published one is open", async () => {
    await expect(groups(ARCHIVED, 'u-stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("shows a draft league's groups to its managers (ruling 73)", async () => {
    await expect(groups(DRAFT_A, 'u-league-admin').then(idsOf)).resolves.toEqual(['g-draft']);
    await expect(groups(DRAFT_A, 'u-padmin').then(idsOf)).resolves.toEqual(['g-draft']);
  });

  it("shows a draft league's groups to an admin of a member club (ruling 76)", async () => {
    await expect(groups(DRAFT_A, MEMBER_CLUB_ADMIN).then(idsOf)).resolves.toEqual(['g-draft']);
  });

  it('answers 404 for a league that does not exist', async () => {
    await expect(groups(NOBODY, 'u-padmin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads each deciding column', async () => {
    await groups(PUBLISHED, 'u-stranger');
    expect(selectsFor(db.from, 'leagues')).toEqual(['status, public_visibility']);
  });
});

describe("a league's groups for its manage page (listLeagueGroups)", () => {
  const groups = (leagueId: string, caller?: string) =>
    leagues.listLeagueGroups(leagueId, req(caller));

  it('refuses a caller with no token, before any read', async () => {
    await expect(groups(PUBLISHED)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('refuses everyone who does not manage the league, a published one too (ruling 73)', async () => {
    const answers = await refusals(
      (caller) => groups(PUBLISHED, caller),
      [...NOT_MANAGERS_OF_A, MEMBER_CLUB_ADMIN, 'u-league-admin'],
    );
    expect(answers.size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('league_groups');
  });

  it("refuses a member club's admin on the draft the picker shows them (ruling 76 is not a manage path)", async () => {
    await expect(groups(DRAFT_A, MEMBER_CLUB_ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("shows the league's managers its groups", async () => {
    await expect(groups(DRAFT_A, 'u-league-admin').then(idsOf)).resolves.toEqual(['g-draft']);
    await expect(groups(PUBLISHED, 'u-padmin').then(idsOf)).resolves.toEqual(['g-pub']);
  });
});
