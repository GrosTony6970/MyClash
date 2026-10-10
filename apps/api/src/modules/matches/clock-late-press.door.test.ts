import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { ClockService } from './clock.service';
import { MatchesController } from './matches.controller';

/**
 * The door of a clock press sent late: `POST /matches/:id/clock` with an id.
 *
 * A pad sends its queue after its Event was completed, or archived itself. As
 * for a hit (rulings 233, 240), "who may score" must leave the over Event to
 * the handler: it answers a press the server holds, and refuses a new one with
 * the code the pad holds. So the REAL controller, the REAL "who may score" and
 * the REAL clock run here, over one seeded database.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const LICE = 'lice-1';
const USER = 'a0000000-0000-4000-8000-000000000001';
const SAVED = 'a0000000-0000-4000-8000-0000000000aa';
const NEW = 'a0000000-0000-4000-8000-0000000000bb';
const TIMES = { pressedAt: '2026-10-03T10:00:00.000Z', sentAt: '2026-10-03T10:30:00.000Z' };
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

type Caller = 'user' | 'pin' | 'super admin';
const OVER = ['completed', 'archived'];

/** The clock ran for a minute. The Halt came from a pad's queue, with its id. */
const TIMELINE = [
  {
    id: 'e1',
    match_id: MATCH,
    sequence: 1,
    type: 'start',
    occurred_at: '2026-10-03T09:00:00.000Z',
  },
  {
    id: 'e2',
    match_id: MATCH,
    sequence: 2,
    type: 'halt',
    occurred_at: '2026-10-03T09:01:00.000Z',
    client_uuid: SAVED,
  },
];

/** One halted bout of one Event, a saved Halt, and one pad account on `piste`. */
function database(status: string, piste: string) {
  const event = { organization_id: ORG, status };
  return mockSupabase({
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: LICE,
          status: 'paused',
          locked_at: null,
          started_at: '2026-10-03T09:00:00.000Z',
          red_score: 3,
          blue_score: 1,
          awaiting_round_advance: false,
          phases: {
            type: 'pool',
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              ruleset_config: {},
              events: event,
            },
          },
        },
      ],
    },
    match_events: {
      rows: TIMELINE,
    },
    events: { rows: [{ id: EVENT, ...event, end_date: '2026-10-03' }] },
    platform_roles: { rows: [] },
    event_staff_accounts: {
      rows: [{ id: 'staff-1', event_id: EVENT, status: 'active', role: 'scoring' }],
    },
    event_staff_lice_assignments: {
      rows: [{ id: 'assignment-1', staff_account_id: 'staff-1', lice_id: piste }],
    },
  });
}

function setup(status: string, caller: Caller, piste = LICE) {
  const db = database(status, piste);
  const staff = new StaffService(
    db as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    { verify: () => ({ sub: 'staff-1', event_id: EVENT, type: 'staff' }) } as never,
    {} as never,
  );
  const inner = staff as never as {
    getSupabaseUserId: () => Promise<string | null>;
    isSuperAdmin: () => Promise<boolean>;
  };
  vi.spyOn(inner, 'getSupabaseUserId').mockResolvedValue(caller === 'pin' ? null : USER);
  vi.spyOn(inner, 'isSuperAdmin').mockResolvedValue(caller === 'super admin');

  /** The door of the pad of before: `MatchesService.clockAction`. */
  const before = { clockAction: vi.fn().mockResolvedValue('the clock of before') };
  const controller = new MatchesController(
    before as never,
    {} as never,
    new ClockService(db as never),
    staff,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const req = (caller === 'pin'
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: {} }) as unknown as FastifyRequest;
  const send = (body: Record<string, unknown>) => controller.clockAction(MATCH, body as never, req);
  return { db, before, send };
}

const everyCaller = OVER.flatMap((status) =>
  (['user', 'pin', 'super admin'] as Caller[]).map((caller) => [status, caller] as const),
);

describe('a clock press from a pad’s queue, sent to an over Event', () => {
  it.each(everyCaller)('a saved press is answered with the clock (%s Event, %s)', async (s, c) => {
    const { db, send } = setup(s, c);

    await expect(send({ action: 'halt', clientUuid: SAVED, ...TIMES })).resolves.toMatchObject({
      matchId: MATCH,
      status: 'halted',
      activeMs: 60_000,
    });
    expect(db.writes).toEqual([]);
  });

  it.each(everyCaller)('a new press is refused to everybody (%s Event, %s)', async (s, c) => {
    const { db, send } = setup(s, c);

    await expect(send({ action: 'resume', clientUuid: NEW, ...TIMES })).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });

  it.each(OVER)('still asks who may score: another piste’s pad is refused (%s)', async (status) => {
    const { send } = setup(status, 'pin', 'lice-2');

    await expect(send({ action: 'halt', clientUuid: SAVED, ...TIMES })).rejects.toThrow(
      /not assigned to this Lice/i,
    );
  });

  it.each(OVER)('a press of the pad of before is refused as before (%s Event)', async (status) => {
    const { before, send } = setup(status, 'pin');

    await expect(send({ action: 'resume' })).rejects.toThrow(/not open for staff scoring/i);
    expect(before.clockAction).not.toHaveBeenCalled();
  });
});

describe('a clock press from a pad’s queue, on a running Event', () => {
  it('is written by the clock, under the pad’s own account', async () => {
    const { db, before, send } = setup('running', 'pin');

    await send({ action: 'resume', clientUuid: NEW, ...TIMES });

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'resume',
      client_uuid: NEW,
      staff_account_id: 'staff-1',
      by_user_id: null,
    });
    expect(before.clockAction).not.toHaveBeenCalled();
  });

  it('a body with no id goes through the door of before, unchanged', async () => {
    const { db, before, send } = setup('running', 'pin');

    await expect(send({ action: 'resume', reason: 'go' })).resolves.toBe('the clock of before');

    expect(before.clockAction).toHaveBeenCalledWith(
      MATCH,
      'resume',
      'go',
      { staffAccountId: 'staff-1', canOverrideLocked: false, canDiscardDependentResults: false },
      false,
    );
    expect(db.writes).toEqual([]);
  });

  it('half a press is a bad request, and reaches neither door', async () => {
    const { db, before, send } = setup('running', 'pin');

    await expect(send({ action: 'resume', clientUuid: NEW })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(send({ action: 'reopen', clientUuid: NEW, ...TIMES })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(before.clockAction).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
});
