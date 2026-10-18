import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { ClockService } from './clock.service';
import { levelPressSchema } from './dto/matches.dto';
import { lateLevelPressOf } from './level-step';
import { MatchesController } from './matches.controller';

/**
 * The door of a step of a level bout sent late:
 * `POST /matches/:id/level-resolution/advance` with an id.
 *
 * A pad sends its queue after its Event was completed, or archived itself. As
 * for a clock press sent late, "who may score" must leave the over Event to the
 * handler: it answers a step the server holds, and refuses a new one with the
 * code the pad holds. So the REAL controller, the REAL "who may score" and the
 * REAL clock service run here, over one seeded database.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const LICE = 'lice-1';
const USER = 'a0000000-0000-4000-8000-000000000001';
const SAVED = 'a0000000-0000-4000-8000-0000000000aa';
const NEW = 'a0000000-0000-4000-8000-0000000000bb';
/** The tap is half a minute old when it is sent. */
const sentNow = () => ({
  pressedAt: new Date(Date.now() - 30_000).toISOString(),
  sentAt: new Date().toISOString(),
});
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

type Caller = 'user' | 'pin' | 'super admin';
const OVER = ['completed', 'archived'];

const event = (sequence: number, type: string, second: string, more = {}) => ({
  id: `e${sequence}`,
  match_id: MATCH,
  sequence,
  type,
  occurred_at: `2026-10-03T09:${second}.000Z`,
  reason: null,
  adjustment_ms: null,
  ...more,
});

/** A bracket bout, 2 - 2, its 90 seconds fought. `saved`: the server holds the first step. */
function database(status: string, piste: string, saved: boolean) {
  const ofEvent = { organization_id: ORG, status };
  const timeline = [event(1, 'start', '00:00'), event(2, 'halt', '01:30')];
  if (saved) {
    timeline.push(
      event(3, 'level_resolution', '01:40', { client_uuid: SAVED, adjustment_ms: -60_000 }),
    );
  }
  return mockSupabase({
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: LICE,
          status: 'paused',
          locked_at: null,
          current_round: 1,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: null,
          red_score: 2,
          blue_score: 2,
          match_number_label: 'QF1',
          awaiting_round_advance: false,
          back_in_play_at: null,
          phases: {
            type: 'single_elim',
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              events: ofEvent,
            },
          },
          match_rules: { ruleset_config: {}, scoring_config_json: {} },
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

function setup(status: string, caller: Caller, { piste = LICE, saved = false } = {}) {
  const db = database(status, piste, saved);
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

  const controller = new MatchesController(
    {} as never,
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
  const send = (body: Record<string, unknown>) =>
    controller.advanceLevelResolution(MATCH, body, req);
  return { db, send };
}

const everyCaller = OVER.flatMap((status) =>
  (['user', 'pin', 'super admin'] as Caller[]).map((caller) => [status, caller] as const),
);

describe('a step of a level bout from a pad’s queue, sent to an over Event', () => {
  it.each(everyCaller)('a saved one is answered (%s Event, %s)', async (status, caller) => {
    const { db, send } = setup(status, caller, { saved: true });

    await expect(
      send({ clientUuid: SAVED, round: 1, step: 0, ...sentNow() }),
    ).resolves.toMatchObject({ status: 'halted', levelResolutionSteps: 1, activeMs: 30_000 });
    expect(db.writes).toEqual([]);
  });

  it.each(everyCaller)('a new one is refused to everybody (%s Event, %s)', async (s, caller) => {
    const { db, send } = setup(s, caller);

    await expect(send({ clientUuid: NEW, round: 1, step: 0, ...sentNow() })).rejects.toEqual(
      FROZEN,
    );
    expect(db.writes).toEqual([]);
  });

  it.each(OVER)('still asks who may score: another piste’s pad is refused (%s)', async (status) => {
    const { send } = setup(status, 'pin', { piste: 'lice-2', saved: true });

    await expect(send({ clientUuid: SAVED, round: 1, step: 0, ...sentNow() })).rejects.toThrow(
      /not assigned to this Lice/i,
    );
  });

  it.each(OVER)('the press of the pad of before is refused as before (%s)', async (status) => {
    const { db, send } = setup(status, 'pin');

    await expect(send({})).rejects.toThrow(/not open for staff scoring/i);
    expect(db.writes).toEqual([]);
  });
});

describe('a step of a level bout from a pad’s queue, on a running Event', () => {
  it('is taken under the pad’s own account, and answered with the clock alone', async () => {
    const { db, send } = setup('running', 'pin');

    const answer = await send({ clientUuid: NEW, round: 1, step: 0, ...sentNow() });

    expect(answer).toMatchObject({ matchId: MATCH, status: 'halted' });
    expect(answer).not.toHaveProperty('applied');
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'level_resolution',
      client_uuid: NEW,
      staff_account_id: 'staff-1',
      by_user_id: null,
      adjustment_ms: -60_000,
    });
  });

  it('a body with no id takes the step now: its row carries no id, its answer names the step', async () => {
    const { db, send } = setup('running', 'pin');

    await expect(send({})).resolves.toMatchObject({
      applied: { kind: 'extra_time', seconds: 60 },
      clock: { matchId: MATCH },
    });

    expect(writesTo(db, 'match_events')[0]?.row).not.toHaveProperty('client_uuid');
  });

  it('half a step is a bad request, and writes nothing', async () => {
    const { db, send } = setup('running', 'pin');

    await expect(send({ clientUuid: NEW, round: 1, ...sentNow() })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.writes).toEqual([]);
  });
});

describe('the late step a body names', () => {
  const whole = { clientUuid: NEW, round: 1, step: 0, ...sentNow() };

  it('is none for the body of the pad of before', () => {
    expect(lateLevelPressOf({})).toBeNull();
  });

  it('is the five fields of a whole one, the first step of a round too (step 0)', () => {
    expect(lateLevelPressOf(whole)).toEqual(whole);
  });

  it.each(['clientUuid', 'round', 'step', 'pressedAt', 'sentAt'] as const)(
    'refuses half a step: no %s',
    (missing) => {
      const { [missing]: _, ...half } = whole;
      expect(() => lateLevelPressOf(half)).toThrow(/names its id, its round, its place/);
    },
  );
});

describe('the body the route takes', () => {
  const whole = { clientUuid: NEW, round: 1, step: 0, ...sentNow() };
  const takes = (body: unknown) => levelPressSchema.safeParse(body).success;

  it('takes the empty body of the pad of before, and a whole late step', () => {
    expect(takes({})).toBe(true);
    expect(takes(whole)).toBe(true);
    expect(takes({ ...whole, step: 1 })).toBe(true);
  });

  it.each([
    ['round 0', { ...whole, round: 0 }],
    ['a step under zero', { ...whole, step: -1 }],
    ['a step that is not a whole number', { ...whole, step: 0.5 }],
    ['an id that is not a uuid', { ...whole, clientUuid: 'press-1' }],
    ['a time that is not a time', { ...whole, sentAt: 'ten past' }],
    ['a field it does not know', { ...whole, action: 'start' }],
  ])('refuses %s', (_, body) => {
    expect(takes(body)).toBe(false);
  });
});
