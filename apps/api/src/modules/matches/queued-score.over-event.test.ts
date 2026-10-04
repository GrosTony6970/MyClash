import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { PenaltiesController } from '../penalties/penalties.controller';
import { PenaltiesService } from '../penalties/penalties.service';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

/**
 * A pad's queue reaches the handler on an over Event (rulings 233, 240, 240a).
 *
 * The pad scores offline, one hit reaches the server and its answer is lost,
 * and the Event is completed (or archives itself) before the pad reconnects.
 * The handler answers a saved hit with its row and refuses a new one with
 * `event_results_frozen`, which the pad holds. Neither was reachable: "who may
 * score" refused everybody on an over Event first, with a 403 the pad retries
 * for ever. The service tests called the service and never saw it.
 *
 * So the REAL controller, the REAL "who may score" and the REAL handler run
 * here, over one seeded database.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const LICE = 'lice-1';
const USER = 'a0000000-0000-4000-8000-000000000001';
const SAVED_HIT = { id: 'ex-1', client_uuid: 'hit-saved', match_id: MATCH, sequence: 3 };
const SAVED_CARD = { id: 'card-1', client_uuid: 'card-saved', match_id: MATCH, voided: false };
const HIT = { sequence: 3, type: 'no_exchange', occurredAt: '2026-10-03T10:00:00.000Z' };
const CARD = {
  registrationId: 'reg-red',
  occurredAt: '2026-10-03T10:00:00.000Z',
  directCard: 'yellow',
  reason: 'late hit',
};
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

type Over = 'completed' | 'archived';
type Caller = 'user' | 'pin';
const OVER: Over[] = ['completed', 'archived'];

/** What makes one caller somebody who may NOT score this bout. */
interface Odd {
  /** The piste the PIN account is assigned to. */
  piste?: string;
  accountStatus?: string;
  /** The Event the PIN session was opened for. */
  sessionEvent?: string;
  /** The PIN session has ended. */
  sessionOver?: true;
  /** The account holds no scorekeeper role in the organisation. */
  noRole?: true;
  accountRole?: string;
  /** What the role check throws that is not a refusal. */
  roleCheckFails?: Error;
}

/** One bout of one Event, with a saved hit, a saved card and one scoring account. */
function database(status: string, odd: Odd) {
  return mockSupabase({
    exchanges: { rows: [SAVED_HIT] },
    match_penalties: { rows: [SAVED_CARD] },
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: LICE,
          phase_id: 'phase-1',
          locked_at: null,
          current_round: 1,
          phases: {
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              events: { organization_id: ORG, status },
            },
          },
        },
      ],
    },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: EVENT, penalty_ruleset_id: 'ruleset-1' }],
    },
    events: { rows: [{ id: EVENT, organization_id: ORG, status, end_date: '2026-10-03' }] },
    platform_roles: { rows: [] },
    event_staff_accounts: {
      rows: [
        {
          id: 'staff-1',
          event_id: EVENT,
          status: odd.accountStatus ?? 'active',
          role: odd.accountRole ?? 'scoring',
        },
        { id: 'staff-1', event_id: 'event-2', status: 'active', role: 'scoring' },
      ],
    },
    event_staff_lice_assignments: {
      rows: [{ id: 'assignment-1', staff_account_id: 'staff-1', lice_id: odd.piste ?? LICE }],
    },
  });
}

/** The organisation's role check: it passes, refuses, or fails. */
function roleCheck(odd: Odd) {
  const refused = odd.roleCheckFails ?? (odd.noRole ? new ForbiddenException('no role') : null);
  return refused ? vi.fn().mockRejectedValue(refused) : vi.fn().mockResolvedValue(undefined);
}

function setup(status: string, caller: Caller, odd: Odd = {}) {
  const db = database(status, odd);
  const assertOrgRole = roleCheck(odd);
  const verify = () => {
    if (odd.sessionOver) throw new UnauthorizedException('Staff session expired');
    return { sub: 'staff-1', event_id: odd.sessionEvent ?? EVENT, type: 'staff' };
  };
  const staff = new StaffService(
    db as never,
    { assertOrgRole } as never,
    { verify } as never,
    {} as never,
  );
  vi.spyOn(
    staff as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(caller === 'user' ? USER : null);

  const frozen = new FrozenResultsGuard(db as never, {} as never);
  const scoring = { recomputeMatchScore: vi.fn() };
  const matches = new MatchesController(
    new MatchesService(
      db as never,
      scoring as never,
      {} as never,
      {} as never,
      {} as never,
      frozen,
    ),
    {} as never,
    {} as never,
    staff,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const penalties = new PenaltiesController(
    new PenaltiesService(db as never, scoring as never, frozen),
    {} as never,
    staff,
    {} as never,
  );
  const req = (caller === 'pin'
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: {} }) as unknown as FastifyRequest;
  return { db, matches, penalties, req };
}

const cases = OVER.flatMap((status) => [
  [status, 'user'] as [Over, Caller],
  [status, 'pin'] as [Over, Caller],
]);

describe('a hit from a pad’s queue, sent to an over Event', () => {
  it.each(cases)('a saved hit is answered with its row (%s Event, %s)', async (status, caller) => {
    const { db, matches, req } = setup(status, caller);
    await expect(
      matches.createExchange(MATCH, { ...HIT, clientUuid: 'hit-saved' } as never, req),
    ).resolves.toEqual(SAVED_HIT);
    expect(db.writes).toEqual([]);
  });

  it.each(cases)(
    'a new hit gets the over-Event refusal the pad holds (%s Event, %s)',
    async (status, caller) => {
      const { db, matches, req } = setup(status, caller);
      await expect(
        matches.createExchange(MATCH, { ...HIT, clientUuid: 'hit-new' } as never, req),
      ).rejects.toEqual(FROZEN);
      expect(db.writes).toEqual([]);
    },
  );

  it.each(OVER)('still asks who may score: another piste’s pad is refused (%s)', async (status) => {
    const { matches, req } = setup(status, 'pin', { piste: 'lice-2' });
    await expect(
      matches.createExchange(MATCH, { ...HIT, clientUuid: 'hit-saved' } as never, req),
    ).rejects.toThrow(/not assigned to this Lice/i);
  });

  // Each asks for the SAVED hit, so only the person check can refuse it.
  it.each<[string, Caller, Odd, RegExp]>([
    ['an account with no scorekeeper role', 'user', { noRole: true }, /no role/],
    ['a disabled PIN account', 'pin', { accountStatus: 'disabled' }, /account is disabled/i],
    ['a pad signed into another Event', 'pin', { sessionEvent: 'event-2' }, /Wrong staff event/i],
    ['a PIN session that has ended', 'pin', { sessionOver: true }, /session expired/i],
  ])('still refuses %s', async (_who, caller, odd, refusal) => {
    const { matches, penalties, req } = setup('completed', caller, odd);
    await expect(
      matches.createExchange(MATCH, { ...HIT, clientUuid: 'hit-saved' } as never, req),
    ).rejects.toThrow(refusal);
    await expect(
      penalties.createPenalty(MATCH, { ...CARD, clientUuid: 'card-saved' } as never, req),
    ).rejects.toThrow(refusal);
  });
});

describe('a card from a pad’s queue, sent to an over Event', () => {
  it.each(OVER)('a saved card is answered with its row (%s Event)', async (status) => {
    const { db, penalties, req } = setup(status, 'pin');
    await expect(
      penalties.createPenalty(MATCH, { ...CARD, clientUuid: 'card-saved' } as never, req),
    ).resolves.toEqual(SAVED_CARD);
    expect(db.writes).toEqual([]);
  });

  it.each(OVER)('a new card gets the over-Event refusal (%s Event)', async (status) => {
    const { db, penalties, req } = setup(status, 'pin');
    await expect(
      penalties.createPenalty(MATCH, { ...CARD, clientUuid: 'card-new' } as never, req),
    ).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });
});

/**
 * Rulings 244, 245, 245a. A refusal about the PERSON meets every hit of the
 * queue: the pad stops at it and says why, so it carries its own code. A refusal
 * about the BOUT carries none: the pad holds that hit and the queue goes on.
 */
describe('a queued hit refused for who sends it', () => {
  const refusalOf = (attempt: Promise<unknown>) =>
    attempt.then(
      () => null,
      (error: ForbiddenException) => error.getResponse() as { code?: string; message: string },
    );
  const sendBoth = ({ matches, penalties, req }: ReturnType<typeof setup>) => [
    matches.createExchange(MATCH, { ...HIT, clientUuid: 'hit-new' } as never, req),
    penalties.createPenalty(MATCH, { ...CARD, clientUuid: 'card-new' } as never, req),
  ];

  it.each<[string, Caller, Odd, string, string]>([
    ['an account with no role', 'user', { noRole: true }, 'account_cannot_score', 'no role'],
    [
      'a disabled PIN account',
      'pin',
      { accountStatus: 'disabled' },
      'staff_account_disabled',
      'Staff account is disabled',
    ],
    [
      'a PIN account whose role cannot score',
      'pin',
      { accountRole: 'checkin' },
      'staff_role_not_allowed',
      'Staff account role cannot use this surface',
    ],
  ])('%s is refused with its own code', async (_who, caller, odd, code, message) => {
    for (const attempt of sendBoth(setup('running', caller, odd))) {
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      expect(await refusalOf(attempt)).toEqual({ message, code });
    }
  });

  it.each<[string, Odd]>([
    ['another piste’s pad', { piste: 'lice-2' }],
    ['a pad signed into another Event', { sessionEvent: 'event-2' }],
  ])('%s is refused about the bout, with no code', async (_who, odd) => {
    for (const attempt of sendBoth(setup('running', 'pin', odd))) {
      expect(await refusalOf(attempt)).not.toHaveProperty('code');
    }
  });

  it('a role check that fails, or finds no valid login, is not "no role"', async () => {
    const failed = new Error('membership read failed: timeout');
    for (const attempt of sendBoth(setup('running', 'user', { roleCheckFails: failed }))) {
      await expect(attempt).rejects.toBe(failed);
    }
    const noLogin = new UnauthorizedException('Authentication required');
    for (const attempt of sendBoth(setup('running', 'user', { roleCheckFails: noLogin }))) {
      await expect(attempt).rejects.toBe(noLogin);
    }
  });
});

describe('every other pad write stays closed on an over Event', () => {
  it.each(OVER)('a round advance is refused by "who may score" (%s Event)', async (status) => {
    const { matches, req } = setup(status, 'user');
    await expect(matches.advanceRound(MATCH, req)).rejects.toThrow(/not open for staff scoring/i);
  });

  it.each(OVER)('a pad’s PIN session is refused there too (%s Event)', async (status) => {
    const { matches, req } = setup(status, 'pin');
    await expect(matches.advanceRound(MATCH, req)).rejects.toThrow(/not open for staff scoring/i);
  });

  it('only the two queue routes leave the over Event to their handler', () => {
    const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');
    const sources =
      read('matches.controller.ts') + read('..', 'penalties', 'penalties.controller.ts');
    expect(sources.split("'leave-to-handler'").length - 1).toBe(2);
  });
});
