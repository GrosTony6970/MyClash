/**
 * The two forfeit-rules reads (ruling 70), through the real router, Nest's pipes, the real
 * org-role check and the pin doors' rule, over seeded tables.
 *
 * The story: Club A's Tournament pins Club A's private ruleset and changes two of its rules. Its
 * scorekeeper opens Basics and reads the rules it plays. Mallory, admin of her own club, asks for
 * Club B's private ruleset by id, through her own Event and Tournament, to read its rules: she is
 * refused, with no rules in the body. A pick is an admin's, so the scorekeeper asking with one is
 * refused too, and a stranger reads nothing at all.
 *
 * The route-authz scan passes a refuser that guards one branch, so each branch has its own case.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLUB_START_FORFEIT_RULES, FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ForfeitRulesController } from './forfeit-rules.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_A_UNPINNED = '12121212-1212-4121-8121-121212121212';
const EVENT_M = '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a';
const T_PINNED = '33333333-3333-4333-8333-333333333333';
const T_PLAIN = '34343434-3434-4343-8343-343434343434';
const T_BAD = '35353535-3535-4353-8353-353535353535';
const T_M = '3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a';
const BUILT_IN = '66666666-6666-4666-8666-666666666666';
const SHARED_B = '77777777-7777-4777-8777-777777777777';
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const PRIVATE_B = '99999999-9999-4999-8999-999999999999';
const MISSING = '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a';

/** Club A's changes of its ruleset: a MARKER score, and a 2nd black card that ends the bout. */
const CHANGES = { reasons: { voluntary: { opponentScore: 37 } }, secondBlackCard: 'match' };
/** Club B's private rules: a MARKER disqualify-after that no other ruleset holds. */
const B_RULES = { ...CLUB_START_FORFEIT_RULES, disqualifyAfter: 7 };

function ruleset(id: string, fields: Record<string, unknown>) {
  return {
    id,
    version: '1.0.0',
    built_in: false,
    public_visibility: false,
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: 'match',
    second_black_card_forfeit: 'tournament',
    forfeit_rules: CLUB_START_FORFEIT_RULES,
    ...fields,
  };
}

const tournament = (id: string, eventId: string, fields: Record<string, unknown> = {}) => ({
  id,
  event_id: eventId,
  penalty_ruleset_id: null,
  forfeit_rules: null,
  ...fields,
});

const db = mockSupabase({
  penalty_rulesets: {
    rows: [
      ruleset(BUILT_IN, {
        built_in: true,
        owner_organization_id: null,
        forfeit_rules: FFAMHE_FORFEIT_RULES,
      }),
      ruleset(SHARED_B, {
        public_visibility: true,
        owner_organization_id: 'org-b',
        first_black_card_forfeit: 'tournament',
      }),
      ruleset(PRIVATE_A, {
        owner_organization_id: 'org-a',
        forfeit_rules: { ...CLUB_START_FORFEIT_RULES, disqualifyAfter: 3 },
      }),
      ruleset(PRIVATE_B, { owner_organization_id: 'org-b', forfeit_rules: B_RULES }),
    ],
  },
  events: {
    rows: [
      { id: EVENT_A, organization_id: 'org-a', penalty_ruleset_id: SHARED_B },
      { id: EVENT_A_UNPINNED, organization_id: 'org-a', penalty_ruleset_id: null },
      { id: EVENT_M, organization_id: 'org-m', penalty_ruleset_id: null },
    ],
  },
  tournaments: {
    rows: [
      tournament(T_PINNED, EVENT_A, { penalty_ruleset_id: PRIVATE_A, forfeit_rules: CHANGES }),
      tournament(T_PLAIN, EVENT_A),
      // A hand-edited archive restored a change the API never stores (10d).
      tournament(T_BAD, EVENT_A, { forfeit_rules: { secondBlackCard: 'foo' } }),
      tournament(T_M, EVENT_M),
    ],
  },
  organization_members: {
    rows: [
      { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
      { organization_id: 'org-a', user_id: 'u-score-a', role: 'scorekeeper' },
      { organization_id: 'org-m', user_id: 'u-mallory', role: 'admin' },
    ],
  },
  platform_roles: { rows: [] },
});

/** The bearer token is the user id: the login itself is not under test here. */
const supabase = { service: db.service, getAuthUser: async (token: string) => ({ id: token }) };

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ForfeitRulesController],
    providers: [
      { provide: SupabaseService, useValue: supabase },
      { provide: OrganizationsService, useValue: new OrganizationsService(supabase as never) },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function read(path: string, user: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/${API_GLOBAL_PREFIX}/${path}`,
    headers: { authorization: `Bearer ${user}` },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, text: res.body };
}

const ROUTES = [
  ['the Tournament route', (pick = '') => `tournaments/${T_PINNED}/forfeit-rules${pick}`],
  ['the Event route', (pick = '') => `events/${EVENT_A}/forfeit-rules${pick}`],
] as const;
const MALLORY_ROUTES = [
  ['the Tournament route', `tournaments/${T_M}/forfeit-rules`],
  ['the Event route', `events/${EVENT_M}/forfeit-rules`],
] as const;

/** No rules leak: no rule key, and no MARKER of Club B's or Club A's. */
function holdsNoRules(text: string) {
  expect(text).not.toMatch(/reasons|disqualifyAfter|inForce|"ruleset"/);
}

describe('the forfeit-rules reads refuse', () => {
  it.each(MALLORY_ROUTES)(
    "%s: another club's private ruleset, to its own club's admin",
    async (_route, path) => {
      const { status, body, text } = await read(
        `${path}?penaltyRulesetId=${PRIVATE_B}`,
        'u-mallory',
      );
      expect(status).toBe(400);
      holdsNoRules(text);
      // A ruleset that does not exist gets the same answer, but for the request's own URL and
      // time: the refusal names no ids.
      const missing = await read(`${path}?penaltyRulesetId=${MISSING}`, 'u-mallory');
      const answer = ({
        instance: _i,
        path: _p,
        timestamp: _t,
        ...rest
      }: Record<string, unknown>) => rest;
      expect(missing.status).toBe(400);
      expect(answer(missing.body)).toEqual(answer(body));
      // The positive twin: the same admin, the same route, a ruleset she may pin.
      expect((await read(`${path}?penaltyRulesetId=${SHARED_B}`, 'u-mallory')).status).toBe(200);
    },
  );

  it.each(ROUTES)('%s: a pick, to a scorekeeper', async (_route, path) => {
    const { status, text } = await read(path(`?penaltyRulesetId=${SHARED_B}`), 'u-score-a');
    expect(status).toBe(403);
    holdsNoRules(text);
    expect((await read(path(`?penaltyRulesetId=${SHARED_B}`), 'u-admin-a')).status).toBe(200);
  });

  it.each(ROUTES)('%s with no pick: a stranger to the club', async (_route, path) => {
    const { status, text } = await read(path(), 'u-mallory');
    expect(status).toBe(403);
    holdsNoRules(text);
  });

  it.each(ROUTES)('%s: an empty pick, at the pipe', async (_route, path) => {
    expect((await read(path('?penaltyRulesetId='), 'u-admin-a')).status).toBe(400);
  });
});

describe('the forfeit-rules reads answer, with no pick, to a scorekeeper', () => {
  it("the Tournament route: its own pin's rules, its changes, and the two laid over each other", async () => {
    const { status, body } = await read(`tournaments/${T_PINNED}/forfeit-rules`, 'u-score-a');
    expect(status).toBe(200);
    expect(body['ruleset']).toMatchObject({
      disqualifyAfter: 3,
      firstBlackCard: 'match',
      secondBlackCard: 'tournament',
    });
    expect(body['changes']).toEqual(CHANGES);
    expect(body['inForce']).toMatchObject({
      disqualifyAfter: 3,
      reasons: { voluntary: { opponentScore: 37, outcome: 'fixed_loss' } },
      secondBlackCard: 'match',
    });
  });

  it("the Event route: the Event's pin, else the built-in, and no changes", async () => {
    const pinned = await read(`events/${EVENT_A}/forfeit-rules`, 'u-score-a');
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({
      ruleset: { disqualifyAfter: 'off', firstBlackCard: 'tournament' },
      changes: null,
    });
    const unpinned = await read(`events/${EVENT_A_UNPINNED}/forfeit-rules`, 'u-score-a');
    expect(unpinned.body).toMatchObject({ inForce: { disqualifyAfter: 2 }, changes: null });
  });

  it("the Tournament route with a pick: the pick's rules under the Tournament's changes", async () => {
    db.from.mockClear();
    const { body } = await read(
      `tournaments/${T_PINNED}/forfeit-rules?penaltyRulesetId=${BUILT_IN}`,
      'u-admin-a',
    );
    expect(body).toMatchObject({
      ruleset: { disqualifyAfter: 2 },
      changes: CHANGES,
      inForce: { disqualifyAfter: 2, secondBlackCard: 'match' },
    });
    // The double answers whatever is asked: the changes come only from this read's projection.
    expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id, forfeit_rules']);
  });

  it('rules that do not parse: no rules in force, the error, and the raw changes to Reset', async () => {
    const { status, body } = await read(`tournaments/${T_BAD}/forfeit-rules`, 'u-score-a');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      inForce: null,
      invalid: 'forfeit_rules_invalid',
      changes: { secondBlackCard: 'foo' },
      ruleset: { disqualifyAfter: 'off' },
    });
    // The positive twin: the same Tournament route on a Tournament whose changes parse.
    expect(
      (await read(`tournaments/${T_PLAIN}/forfeit-rules`, 'u-score-a')).body,
    ).not.toHaveProperty('invalid');
  });
});
