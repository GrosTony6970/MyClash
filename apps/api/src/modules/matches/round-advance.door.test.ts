import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { ClockService } from './clock.service';
import { roundPressSchema } from './dto/matches.dto';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { lateRoundPressOf } from './round-advance';
import { ScoringService } from './scoring.service';

/**
 * The door of "Start round N+1" sent late: `POST /matches/:id/rounds/advance`
 * with an id.
 *
 * A pad sends its queue after its Event was completed, or archived itself. As
 * for a clock press sent late, "who may score" must leave the over Event to the
 * handler: it answers an advance the server holds, and refuses a new one with
 * the code the pad holds. So the REAL controller, the REAL "who may score" and
 * the REAL services run here, over one seeded database.
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

const event = (sequence: number, type: string, minute: string, more = {}) => ({
  id: `e${sequence}`,
  match_id: MATCH,
  sequence,
  type,
  occurred_at: `2026-10-03T09:${minute}:00.000Z`,
  ...more,
});

/** Round 1 ran for a minute. `round` is where the bout is; it waits when that is 1. */
function database(status: string, piste: string, round: number) {
  const ofEvent = { organization_id: ORG, status };
  const timeline = [event(1, 'start', '00'), event(2, 'halt', '01')];
  if (round === 2) timeline.push(event(3, 'round_advance', '02', { client_uuid: SAVED }));
  return mockSupabase({
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: LICE,
          status: 'paused',
          locked_at: null,
          current_round: round,
          awaiting_round_advance: round === 1,
          phases: {
            type: 'single_elim',
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              ruleset_config: {},
              events: ofEvent,
            },
          },
        },
      ],
    },
    match_events: { rows: timeline },
    events: { rows: [{ id: EVENT, ...ofEvent, end_date: '2026-10-03' }] },
    platform_roles: { rows: [] },
    event_staff_accounts: {
      rows: [{ id: 'staff-1', event_id: EVENT, status: 'active', role: 'scoring' }],
    },
    event_staff_lice_assignments: {
      rows: [{ id: 'assignment-1', staff_account_id: 'staff-1', lice_id: piste }],
    },
  });
}

function setup(status: string, caller: Caller, { piste = LICE, round = 1 } = {}) {
  const db = database(status, piste, round);
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

  const scoring = new ScoringService(
    db as never,
    undefined as never,
    new ClockService(db as never),
  );
  vi.spyOn(scoring, 'recomputeMatchScore').mockResolvedValue({ redScore: 0, blueScore: 0 });
  const controller = new MatchesController(
    new MatchesService(db as never, scoring, {} as never, {} as never, {} as never),
    {} as never,
    {} as never,
    staff,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const req = (caller === 'pin'
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: {} }) as unknown as FastifyRequest;
  const send = (body: Record<string, unknown>) => controller.advanceRound(MATCH, body, req);
  return { db, send };
}

const everyCaller = OVER.flatMap((status) =>
  (['user', 'pin', 'super admin'] as Caller[]).map((caller) => [status, caller] as const),
);

describe('a "Start round 2" from a pad’s queue, sent to an over Event', () => {
  it.each(everyCaller)('a saved one is answered (%s Event, %s)', async (status, caller) => {
    const { db, send } = setup(status, caller, { round: 2 });

    await expect(send({ clientUuid: SAVED, round: 2, ...TIMES })).resolves.toEqual({
      currentRound: 2,
    });
    expect(db.writes).toEqual([]);
  });

  it.each(everyCaller)('a new one is refused to everybody (%s Event, %s)', async (s, caller) => {
    const { db, send } = setup(s, caller);

    await expect(send({ clientUuid: NEW, round: 2, ...TIMES })).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });

  it.each(OVER)('still asks who may score: another piste’s pad is refused (%s)', async (status) => {
    const { send } = setup(status, 'pin', { piste: 'lice-2', round: 2 });

    await expect(send({ clientUuid: SAVED, round: 2, ...TIMES })).rejects.toThrow(
      /not assigned to this Lice/i,
    );
  });

  it.each(OVER)('the press of the pad of before is refused as before (%s)', async (status) => {
    const { db, send } = setup(status, 'pin');

    await expect(send({})).rejects.toThrow(/not open for staff scoring/i);
    expect(db.writes).toEqual([]);
  });
});

describe('a "Start round 2" from a pad’s queue, on a running Event', () => {
  it('opens the round, under the pad’s own account', async () => {
    const { db, send } = setup('running', 'pin');

    await expect(send({ clientUuid: NEW, round: 2, ...TIMES })).resolves.toEqual({
      currentRound: 2,
    });

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'round_advance',
      client_uuid: NEW,
      staff_account_id: 'staff-1',
      by_user_id: null,
    });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ current_round: 2 });
  });

  it('a body with no id opens the next round now, and its row carries no id', async () => {
    const { db, send } = setup('running', 'pin');

    await expect(send({})).resolves.toEqual({ currentRound: 2 });

    expect(writesTo(db, 'match_events')[0]?.row).not.toHaveProperty('client_uuid');
  });

  it('half an advance is a bad request, and writes nothing', async () => {
    const { db, send } = setup('running', 'pin');

    await expect(send({ clientUuid: NEW, ...TIMES })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toEqual([]);
  });
});

describe('the late advance a body names', () => {
  const whole = { clientUuid: NEW, round: 2, ...TIMES };

  it('is none for the body of the pad of before', () => {
    expect(lateRoundPressOf({})).toBeNull();
  });

  it('is the four fields of a whole one', () => {
    expect(lateRoundPressOf(whole)).toEqual(whole);
  });

  it.each(['clientUuid', 'round', 'pressedAt', 'sentAt'] as const)(
    'refuses half an advance: no %s',
    (missing) => {
      const { [missing]: _, ...half } = whole;
      expect(() => lateRoundPressOf(half)).toThrow(/names its id, the round it opens/);
    },
  );
});

describe('the body the route takes', () => {
  const whole = { clientUuid: NEW, round: 2, ...TIMES };
  const takes = (body: unknown) => roundPressSchema.safeParse(body).success;

  it('takes the empty body of the pad of before, and a whole late advance', () => {
    expect(takes({})).toBe(true);
    expect(takes(whole)).toBe(true);
  });

  it.each([
    ['round 1, which no press opens', { ...whole, round: 1 }],
    ['a round that is not a whole number', { ...whole, round: 2.5 }],
    ['an id that is not a uuid', { ...whole, clientUuid: 'press-1' }],
    ['a time that is not a time', { ...whole, pressedAt: 'ten past' }],
    ['a field it does not know', { ...whole, action: 'start' }],
  ])('refuses %s', (_, body) => {
    expect(takes(body)).toBe(false);
  });
});
