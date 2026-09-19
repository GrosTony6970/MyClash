/**
 * Who may read and change a Swiss phase.
 *
 * Until 2026-09-19 these eleven routes resolved the caller only to write their
 * name in the audit log, and took a missing name as "no human actor". With the
 * guard in shadow mode (the production default) a caller with no token could
 * generate, re-pair, withdraw from, finalise or rewrite any Event's Swiss phase.
 *
 * The bars (operator ruling 34): the two reads need any member of the Event's
 * organisation; the nine writes need `admin` (`SWISS_WRITE_ROLE` says why). The
 * Event is read from the row each route names — tournament, phase, round or
 * match — never from the caller. Set sides names fighters; each must be entered
 * in the match's own tournament.
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The Swiss services are stubs, so "refused" means "never reached". The double
 * hands back whole rows whatever is selected, so the phase and round rows carry
 * the embedded shape `assertCanManagePhase` and `assertCanManageSwissRound`
 * read, and the last test pins the select strings.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { SwissController } from './swiss.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_A = '33333333-3333-4333-8333-333333333333';
/** A second tournament of Event A: same Event, not the match's tournament. */
const TOURNAMENT_A2 = '44444444-4444-4444-8444-444444444444';
const TOURNAMENT_B = '55555555-5555-4555-8555-555555555555';
const PHASE_A = '66666666-6666-4666-8666-666666666666';
const PHASE_B = '77777777-7777-4777-8777-777777777777';
const ROUND_A = '88888888-8888-4888-8888-888888888888';
const ROUND_B = '99999999-9999-4999-8999-999999999999';
const MATCH_A = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const MATCH_B = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
/** Entered in Event A's Swiss tournament. */
const ANNA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLARA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** Entered in Event A's other tournament. */
const DAVID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** Entered in Event B's tournament. */
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** No row of any kind. */
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type Row = 'A' | 'B' | 'none';
const TOURNAMENT: Record<Row, string> = { A: TOURNAMENT_A, B: TOURNAMENT_B, none: NOBODY };
const PHASE: Record<Row, string> = { A: PHASE_A, B: PHASE_B, none: NOBODY };
const ROUND: Record<Row, string> = { A: ROUND_A, B: ROUND_B, none: NOBODY };
const MATCH: Record<Row, string> = { A: MATCH_A, B: MATCH_B, none: NOBODY };

let db: ReturnType<typeof mockSupabase>;
let stubs: Record<string, Mock>;
let controller: SwissController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    tournaments: {
      rows: [
        { id: TOURNAMENT_B, event_id: EVENT_B },
        { id: TOURNAMENT_A, event_id: EVENT_A },
        { id: TOURNAMENT_A2, event_id: EVENT_A },
      ],
    },
    phases: {
      rows: [
        { id: PHASE_B, tournament_id: TOURNAMENT_B, tournaments: { event_id: EVENT_B } },
        { id: PHASE_A, tournament_id: TOURNAMENT_A, tournaments: { event_id: EVENT_A } },
      ],
    },
    swiss_rounds: {
      rows: [
        { id: ROUND_B, phase_id: PHASE_B, phases: { tournaments: { event_id: EVENT_B } } },
        { id: ROUND_A, phase_id: PHASE_A, phases: { tournaments: { event_id: EVENT_A } } },
      ],
    },
    matches: {
      rows: [
        { id: MATCH_B, phase_id: PHASE_B },
        { id: MATCH_A, phase_id: PHASE_A },
      ],
    },
    registrations: {
      rows: [
        { id: BRUNO, tournament_id: TOURNAMENT_B },
        { id: DAVID, tournament_id: TOURNAMENT_A2 },
        { id: ANNA, tournament_id: TOURNAMENT_A },
        { id: CLARA, tournament_id: TOURNAMENT_A },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-admin-b', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-member-a', role: 'read_only' },
        // Admin elsewhere, editor here: a decision taken on the wrong
        // organisation would let this account run Event A's Swiss.
        { organization_id: 'org-b', user_id: 'u-editor-a', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        // Admin of both: only the same-tournament rule can refuse this account.
        { organization_id: 'org-a', user_id: 'u-admin-ab', role: 'admin' },
        { organization_id: 'org-b', user_id: 'u-admin-ab', role: 'admin' },
      ],
    },
  });
  stubs = Object.fromEntries(
    [
      'getAdminView',
      'generateSwiss',
      'planNextRound',
      'commitNextRound',
      'updateConfig',
      'withdraw',
      'deleteRound',
      'finalise',
      'unfinalise',
      'swapPairing',
      'setMatchSides',
    ].map((name) => [name, vi.fn(async () => ({ ok: name }))]),
  );
  // The token IS the user id here, through either door; no token at all is the
  // anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
    anon: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } } }) } },
  };
  controller = new SwissController(
    stubs as never,
    stubs as never,
    stubs as never,
    stubs as never,
    stubs as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

interface Route {
  handler: string;
  bar: 'member' | 'admin';
  call: (row: Row, request: never) => Promise<unknown>;
  /** The service method the route hands over to, and what it must receive. */
  reaches: string;
  args: (userId: string) => unknown[];
}

const SIDES = { redRegistrationId: ANNA, blueRegistrationId: CLARA };

const ROUTES: Route[] = [
  {
    handler: 'getAdminView',
    bar: 'member',
    call: (row, r) => controller.getAdminView(TOURNAMENT[row], r),
    reaches: 'getAdminView',
    args: () => [TOURNAMENT_A],
  },
  {
    handler: 'generate',
    bar: 'admin',
    call: (row, r) => controller.generate(TOURNAMENT[row], { roundCount: 4 }, r, 'true'),
    reaches: 'generateSwiss',
    args: (userId) => [TOURNAMENT_A, { roundCount: 4 }, true, userId],
  },
  {
    handler: 'previewNextRound',
    bar: 'member',
    call: (row, r) => controller.previewNextRound(PHASE[row], r),
    reaches: 'planNextRound',
    args: () => [PHASE_A],
  },
  {
    handler: 'commitNextRound',
    bar: 'admin',
    call: (row, r) => controller.commitNextRound(PHASE[row], r),
    reaches: 'commitNextRound',
    args: () => [PHASE_A],
  },
  {
    handler: 'updateConfig',
    bar: 'admin',
    call: (row, r) => controller.updateConfig(PHASE[row], { roundCount: 5 }, r),
    reaches: 'updateConfig',
    args: (userId) => [PHASE_A, { roundCount: 5 }, userId],
  },
  {
    handler: 'withdraw',
    bar: 'admin',
    call: (row, r) => controller.withdraw(PHASE[row], { registrationId: ANNA }, r),
    reaches: 'withdraw',
    args: (userId) => [PHASE_A, ANNA, userId],
  },
  {
    handler: 'deleteRound',
    bar: 'admin',
    call: (row, r) => controller.deleteRound(PHASE[row], 2, r),
    reaches: 'deleteRound',
    args: (userId) => [PHASE_A, 2, userId],
  },
  {
    handler: 'finalise',
    bar: 'admin',
    call: (row, r) => controller.finalise(PHASE[row], r),
    reaches: 'finalise',
    args: (userId) => [PHASE_A, userId],
  },
  {
    handler: 'resume',
    bar: 'admin',
    call: (row, r) => controller.resume(PHASE[row], r),
    reaches: 'unfinalise',
    args: (userId) => [PHASE_A, userId],
  },
  {
    handler: 'swap',
    bar: 'admin',
    call: (row, r) =>
      controller.swap(ROUND[row], { aRegistrationId: ANNA, bRegistrationId: CLARA }, r),
    reaches: 'swapPairing',
    args: (userId) => [ROUND_A, ANNA, CLARA, userId, false],
  },
  {
    handler: 'setSides',
    bar: 'admin',
    call: (row, r) => controller.setSides(MATCH[row], SIDES, r),
    reaches: 'setMatchSides',
    args: (userId) => [MATCH_A, ANNA, CLARA, userId, false],
  },
];

const WRITES = ROUTES.filter((route) => route.bar === 'admin');
const READS = ROUTES.filter((route) => route.bar === 'member');

describe('SwissController authorization', () => {
  it('covers every handler of the controller', () => {
    // A route added to the controller and not listed here is checked by nothing.
    const proto = SwissController.prototype as object;
    const routes = Object.getOwnPropertyNames(proto).filter((name) => {
      if (name === 'constructor') return false; // the class: it carries the controller's path
      const value = Object.getOwnPropertyDescriptor(proto, name)?.value as unknown;
      return typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined;
    });
    expect(routes.sort()).toEqual(ROUTES.map((route) => route.handler).sort());
    expect(WRITES).toHaveLength(9);
  });

  it.each(ROUTES)('$handler refuses a caller with no token, before any read', async (route) => {
    await expect(route.call('A', req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stubs[route.reaches]).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
  });

  it.each(ROUTES)(
    '$handler refuses a signed-in account outside the organisation',
    async (route) => {
      await expect(route.call('A', req('u-stranger'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(stubs[route.reaches]).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES)('$handler checks the Event of the row it names', async (route) => {
    // Event B's admin, on Event A's tournament, phase, round or match.
    await expect(route.call('A', req('u-admin-b'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(stubs[route.reaches]).not.toHaveBeenCalled();
  });

  it.each(WRITES)('$handler refuses an editor: a Swiss write needs admin', async (route) => {
    await expect(route.call('A', req('u-editor-a'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(stubs[route.reaches]).not.toHaveBeenCalled();
  });

  it.each(WRITES)('$handler lets an admin of the Event through, as the actor', async (route) => {
    await route.call('A', req('u-admin-a'));
    expect(stubs[route.reaches]).toHaveBeenCalledWith(...route.args('u-admin-a'));
  });

  it.each(READS)('$handler lets any member of the organisation read', async (route) => {
    await route.call('A', req('u-member-a'));
    expect(stubs[route.reaches]).toHaveBeenCalledWith(...route.args('u-member-a'));
  });

  it.each(ROUTES)('$handler answers 404 for a row that does not exist', async (route) => {
    await expect(route.call('none', req('u-admin-a'))).rejects.toBeInstanceOf(NotFoundException);
    expect(stubs[route.reaches]).not.toHaveBeenCalled();
  });

  it.each(['redRegistrationId', 'blueRegistrationId'] as const)(
    "setSides refuses a %s not entered in the match's tournament, with one answer whoever asks",
    async (side) => {
      // Event A's other tournament, Event B's tournament (from an admin of
      // both), and no registration at all: the same 400 each time, so the
      // answer tells no one which ids exist elsewhere.
      const tries = [
        ['u-admin-a', DAVID],
        ['u-admin-ab', BRUNO],
        ['u-admin-a', NOBODY],
      ] as const;
      const answers: unknown[] = [];
      for (const [caller, fighter] of tries) {
        const refusal = await controller
          .setSides(MATCH_A, { ...SIDES, [side]: fighter }, req(caller))
          .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(BadRequestException);
        answers.push((refusal as BadRequestException).getResponse());
      }
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect(stubs['setMatchSides']).not.toHaveBeenCalled();
    },
  );

  it("setSides checks the match's Event, not the Event of a fighter it names", async () => {
    // Event B's admin, seating Event B's own fighter in Event A's match.
    await expect(
      controller.setSides(
        MATCH_A,
        { redRegistrationId: BRUNO, blueRegistrationId: null },
        req('u-admin-b'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(stubs['setMatchSides']).not.toHaveBeenCalled();
  });

  it('setSides checks the role before the fighters it names', async () => {
    // A 400 for an unknown id here would tell a stranger which ids the
    // tournament holds.
    for (const fighter of [ANNA, NOBODY]) {
      await expect(
        controller.setSides(MATCH_A, { ...SIDES, redRegistrationId: fighter }, req('u-stranger')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(stubs['setMatchSides']).not.toHaveBeenCalled();
  });

  it('setSides lets an admin empty both sides, and looks no fighter up', async () => {
    await controller.setSides(
      MATCH_A,
      { redRegistrationId: null, blueRegistrationId: null, confirm: true },
      req('u-admin-a'),
    );
    expect(stubs['setMatchSides']).toHaveBeenCalledWith(MATCH_A, null, null, 'u-admin-a', true);
    expect(queriedTables(db.from)).not.toContain('registrations');
  });

  it('reads each hop from the row that names it', async () => {
    await controller.previewNextRound(PHASE_A, req('u-admin-a'));
    await controller.swap(
      ROUND_A,
      { aRegistrationId: ANNA, bRegistrationId: CLARA },
      req('u-admin-a'),
    );
    await controller.setSides(MATCH_A, SIDES, req('u-admin-a'));
    await controller.generate(TOURNAMENT_A, {}, req('u-admin-a'));
    // The double hands back the whole row whatever is selected, so the outcome
    // alone would stay green with a column dropped from a read.
    expect(selectsFor(db.from, 'swiss_rounds')).toEqual([
      'phases!inner(tournaments!inner(event_id))',
    ]);
    expect(selectsFor(db.from, 'matches')).toEqual(['phase_id']);
    expect(new Set(selectsFor(db.from, 'phases'))).toEqual(
      new Set(['tournaments!inner(event_id)', 'tournament_id']),
    );
    expect(new Set(selectsFor(db.from, 'tournaments'))).toEqual(new Set(['event_id']));
    expect(new Set(selectsFor(db.from, 'events'))).toEqual(new Set(['organization_id']));
    expect(selectsFor(db.from, 'registrations')).toEqual(['id']);
  });
});
