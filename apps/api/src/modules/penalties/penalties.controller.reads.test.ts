/**
 * Who may read penalty rulesets and disqualification reviews.
 *
 * Until 2026-09-23 these six reads resolved no caller at all. With the guard in
 * shadow mode (the production default) anyone could list every organisation's
 * private penalty rulesets and read any Tournament's disqualification reviews.
 *
 * The bars:
 * - the platform-wide list is for platform staff, any tier (operator rulings 62
 *   and 65); an organiser lists through `organizations/:orgId/penalty-rulesets`;
 * - one ruleset, and its lineage: built-in and shared ones for anyone signed in;
 *   a private one for an admin of its organisation or a platform admin
 *   (ruling 61, the RLS `penalty_rulesets_select` rule);
 * - a match's ruleset: the scoring pad's own check, as `penalty-scope` beside it;
 * - a Tournament's ruleset and its reviews: any member of the organisation of
 *   the Tournament's own Event.
 *
 * Driven through the controller and the real service and org-role check over
 * seeded tables. The double hands back whole rows whatever is selected, so the
 * last test pins the select strings the decisions read.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_A = '33333333-3333-4333-8333-333333333333';
const TOURNAMENT_B = '44444444-4444-4444-8444-444444444444';
const MATCH_A = '55555555-5555-4555-8555-555555555555';
const BUILT_IN = '66666666-6666-4666-8666-666666666666';
/** Organisation B's ruleset, shared with the platform. */
const SHARED_B = '77777777-7777-4777-8777-777777777777';
/** Organisation A's own, not shared. Tournament A pins it. */
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const NOBODY = '99999999-9999-4999-8999-999999999999';

/** The columns the lineage lamp and the content projector read. */
function ruleset(id: string, fields: Record<string, unknown>) {
  return {
    id,
    name: `ruleset ${id.slice(0, 4)}`,
    accumulation_scope: 'match',
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: 'match',
    second_black_card_forfeit: 'tournament',
    penalty_ruleset_entries: [{ group_number: 1, ref_number: 'R1', sanctions: ['red'] }],
    ...fields,
  };
}

let db: ReturnType<typeof mockSupabase>;
let service: PenaltiesService;
let authorizeMatchScoring: Mock;
let controller: PenaltiesController;

beforeEach(() => {
  db = mockSupabase({
    penalty_rulesets: {
      rows: [
        ruleset(PRIVATE_A, {
          built_in: false,
          public_visibility: false,
          owner_organization_id: 'org-a',
        }),
        ruleset(SHARED_B, {
          built_in: false,
          public_visibility: true,
          owner_organization_id: 'org-b',
        }),
        ruleset(BUILT_IN, {
          built_in: true,
          public_visibility: false,
          owner_organization_id: null,
        }),
      ],
    },
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b', penalty_ruleset_id: null },
        { id: EVENT_A, organization_id: 'org-a', penalty_ruleset_id: null },
      ],
    },
    tournaments: {
      rows: [
        { id: TOURNAMENT_B, event_id: EVENT_B, penalty_ruleset_id: null },
        { id: TOURNAMENT_A, event_id: EVENT_A, penalty_ruleset_id: PRIVATE_A },
      ],
    },
    tournament_penalty_reviews: {
      rows: [
        { id: 'review-b', tournament_id: TOURNAMENT_B, created_at: '2026-09-01T10:00:00+00:00' },
        { id: 'review-a', tournament_id: TOURNAMENT_A, created_at: '2026-09-01T10:00:00+00:00' },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-admin-b', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-member-a', role: 'read_only' },
      ],
    },
    platform_roles: {
      rows: [
        { user_id: 'u-platform', role: 'platform_admin' },
        { user_id: 'u-viewer', role: 'platform_viewer' },
      ],
    },
  });
  // The token IS the user id here, through either door; no token at all is the
  // anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
    anon: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } } }) } },
  };
  const orgs = new OrganizationsService(db as never);
  service = new PenaltiesService(supabase as never, undefined, undefined, orgs);
  authorizeMatchScoring = vi.fn(async () => {
    throw new ForbiddenException('Staff account is not assigned to this Lice');
  });
  controller = new PenaltiesController(
    service,
    supabase as never,
    { authorizeMatchScoring } as never,
    orgs,
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

interface Read {
  handler: string;
  call: (request: never) => Promise<unknown>;
}

/** Each read, on a row a stranger may not see. */
const READS: Read[] = [
  { handler: 'listRulesets', call: (r) => controller.listRulesets(r) },
  { handler: 'getRuleset', call: (r) => controller.getRuleset(PRIVATE_A, r) },
  { handler: 'getRulesetLineage', call: (r) => controller.getRulesetLineage(PRIVATE_A, r) },
  { handler: 'getMatchPenaltyRuleset', call: (r) => controller.getMatchPenaltyRuleset(MATCH_A, r) },
  {
    handler: 'getTournamentPenaltyRuleset',
    call: (r) => controller.getTournamentPenaltyRuleset(TOURNAMENT_A, r),
  },
  {
    handler: 'listTournamentReviews',
    call: (r) => controller.listTournamentReviews(TOURNAMENT_A, r),
  },
];

/** The reads the caller's own session decides, rather than the scoring pad's check. */
const SESSION_READS = READS.filter((read) => read.handler !== 'getMatchPenaltyRuleset');

describe('PenaltiesController reads', () => {
  it.each(SESSION_READS)(
    '$handler refuses a caller with no token, before any read',
    async (read) => {
      await expect(read.call(req())).rejects.toBeInstanceOf(UnauthorizedException);
      expect(queriedTables(db.from)).toEqual([]);
    },
  );

  it.each(READS)('$handler refuses a signed-in account outside the organisation', async (read) => {
    await expect(read.call(req('u-stranger'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(SESSION_READS)(
    '$handler gives an outsider and an admin of another organisation one answer',
    async (read) => {
      const answers: unknown[] = [];
      for (const caller of ['u-stranger', 'u-admin-b']) {
        const refusal = await read.call(req(caller)).catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ForbiddenException);
        answers.push((refusal as ForbiddenException).getResponse());
      }
      expect(answers[1]).toEqual(answers[0]);
    },
  );

  it('lists every ruleset, private ones included, for platform staff only', async () => {
    // Ruling 65: any platform tier, the viewer included, as every platform read.
    for (const caller of ['u-platform', 'u-viewer']) {
      const rows = (await controller.listRulesets(req(caller))) as Array<{ id: string }>;
      expect(rows.map((row) => row.id).sort()).toEqual([BUILT_IN, PRIVATE_A, SHARED_B].sort());
    }
    // Ruling 62: an organisation's own admin lists through its own organisation.
    await expect(controller.listRulesets(req('u-admin-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a private ruleset by id to a platform viewer (ruling 61 names platform admins)', async () => {
    await expect(controller.getRuleset(PRIVATE_A, req('u-viewer'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([BUILT_IN, SHARED_B])(
    'lets anyone signed in read the adoptable ruleset %s',
    async (id) => {
      await expect(controller.getRuleset(id, req('u-stranger'))).resolves.toMatchObject({ id });
      await expect(controller.getRulesetLineage(id, req('u-stranger'))).resolves.toBeDefined();
    },
  );

  it("lets an admin of the ruleset's own organisation, and a platform admin, read a private one", async () => {
    for (const caller of ['u-admin-a', 'u-platform']) {
      await expect(controller.getRuleset(PRIVATE_A, req(caller))).resolves.toMatchObject({
        id: PRIVATE_A,
      });
      await expect(controller.getRulesetLineage(PRIVATE_A, req(caller))).resolves.toEqual({
        base: expect.any(String),
        status: 'unchanged',
      });
    }
  });

  it('refuses a private ruleset to a read-only member of its own organisation (ruling 61)', async () => {
    await expect(controller.getRuleset(PRIVATE_A, req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.getRulesetLineage(PRIVATE_A, req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 404 for a ruleset that does not exist', async () => {
    await expect(controller.getRuleset(NOBODY, req('u-admin-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("lets any member of the Tournament's organisation read its ruleset and reviews", async () => {
    // Tournament A pins organisation A's private ruleset: its read-only members
    // see it here, where the Tournament uses it.
    await expect(
      controller.getTournamentPenaltyRuleset(TOURNAMENT_A, req('u-member-a')),
    ).resolves.toMatchObject({ id: PRIVATE_A });
    const reviews = (await controller.listTournamentReviews(
      TOURNAMENT_A,
      req('u-member-a'),
    )) as Array<{ id: string }>;
    expect(reviews.map((review) => review.id)).toEqual(['review-a']);
  });

  it('checks the Event of the Tournament it names, not the caller’s own', async () => {
    // Organisation B's admin, on organisation A's Tournament.
    await expect(
      controller.getTournamentPenaltyRuleset(TOURNAMENT_A, req('u-admin-b')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.listTournamentReviews(TOURNAMENT_A, req('u-admin-b')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getTournamentPenaltyRuleset(TOURNAMENT_B, req('u-admin-b')),
    ).resolves.toMatchObject({ id: BUILT_IN });
  });

  it('asks the scoring pad’s check about the match before reading its ruleset', async () => {
    const request = req('u-admin-a');
    await expect(controller.getMatchPenaltyRuleset(MATCH_A, request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authorizeMatchScoring).toHaveBeenCalledWith(request, MATCH_A);
    expect(queriedTables(db.from)).toEqual([]);

    authorizeMatchScoring.mockResolvedValue({ userId: 'u-scorer' });
    const effective = vi
      .spyOn(service, 'getEffectiveRulesetForMatch')
      .mockResolvedValue({ id: BUILT_IN } as never);
    await expect(controller.getMatchPenaltyRuleset(MATCH_A, request)).resolves.toEqual({
      id: BUILT_IN,
    });
    expect(effective).toHaveBeenCalledWith(MATCH_A);
  });

  it('reads each deciding column from the row the route names', async () => {
    await controller.getRuleset(PRIVATE_A, req('u-admin-a'));
    await controller.listTournamentReviews(TOURNAMENT_A, req('u-member-a'));
    await controller.listRulesets(req('u-platform'));
    // The double hands back the whole row whatever is selected, so the outcome
    // alone would stay green with a column dropped from a read. `*` carries
    // built_in, public_visibility and owner_organization_id.
    expect(selectsFor(db.from, 'penalty_rulesets')).toContain('*, penalty_ruleset_entries(*)');
    expect(new Set(selectsFor(db.from, 'tournaments'))).toEqual(new Set(['event_id']));
    expect(new Set(selectsFor(db.from, 'events'))).toEqual(new Set(['organization_id']));
    expect(new Set(selectsFor(db.from, 'organization_members'))).toEqual(new Set(['role']));
    expect(new Set(selectsFor(db.from, 'platform_roles'))).toEqual(new Set(['role']));
  });
});
