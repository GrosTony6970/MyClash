import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiExceptionFilter, type ApiErrorResponse } from '../../common/api-exception.filter';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { ROUND_AWAITS_ADVANCE, roundAwaitsAdvance } from './round-awaits-advance';

/**
 * The clock does not start between two rounds (operator, 2026-10-09).
 *
 * A best-of-3 bout: round 1 just ended, and the table's tablet says "Round 1
 * complete". A second tablet opened on the same bout a minute earlier still
 * shows a live Resume. It is tapped, and the server started the clock while
 * nobody fought. "Start round 2" then halted and reset it: a false resume and
 * halt in the bout's timeline.
 */
const BOUT = 'm1';
const AT = (minute: number) => `2026-04-25T09:0${minute}:00.000Z`;

const STARTED = [{ id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0) }];
/** A round that closed: the server halted the clock. */
const HALTED = [
  ...STARTED,
  { id: 'e2', match_id: BOUT, sequence: 2, type: 'halt', occurred_at: AT(1) },
];
/** A clock that never ran: its one legal action is Start. */
const IDLE: Record<string, unknown>[] = [];

/** The type of the one clock event an action wrote. */
function eventWritten(db: ReturnType<typeof setup>['db']) {
  const writes = writesTo(db, 'match_events');
  expect(writes).toHaveLength(1);
  return (writes[0]?.row as { type?: string } | undefined)?.type;
}

function setup(row: Record<string, unknown>, events: Record<string, unknown>[]) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'paused',
          locked_at: null,
          started_at: AT(0),
          rounds_json: [{ round: 1, winnerColor: 'red' }],
          current_round: 1,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: null,
          red_score: 3,
          blue_score: 1,
          match_number_label: 'P1M1',
          awaiting_round_advance: true,
          phases: { type: 'pool', tournaments: { ruleset_config: {} } },
          ...row,
        },
      ],
    },
    match_events: {
      rows: events.map((event) => ({ reason: null, adjustment_ms: null, ...event })),
    },
  });
  return { db, clock: new ClockService(db as never) };
}

/** What a browser receives for an exception the clock threw. */
function answerOf(exception: unknown): ApiErrorResponse {
  let sent: ApiErrorResponse | undefined;
  const reply = {
    status: () => reply,
    header: () => reply,
    send: (body: ApiErrorResponse) => {
      sent = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/v1/matches/m1/clock', headers: {} }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  if (!sent) throw new Error('the filter sent no answer');
  return sent;
}

describe('ClockService.clockAction — between two rounds', () => {
  it('refuses a Resume, and writes nothing', async () => {
    const { db, clock } = setup({}, HALTED);

    const refused = await clock.clockAction(BOUT, 'resume').catch((err: unknown) => err);

    expect(answerOf(refused).code).toBe('round_awaits_advance');
    expect(writesTo(db, 'match_events')).toEqual([]);
    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('refuses a Start on a clock that never ran, and writes nothing', async () => {
    const { db, clock } = setup({}, IDLE);

    const refused = await clock.clockAction(BOUT, 'start').catch((err: unknown) => err);

    expect(answerOf(refused).code).toBe('round_awaits_advance');
    expect(writesTo(db, 'match_events')).toEqual([]);
    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('reads the flag it decides on', async () => {
    const { db, clock } = setup({}, HALTED);

    await clock.clockAction(BOUT, 'resume').catch(() => undefined);

    // The double ignores the projection: without this, the column can leave
    // the read and every case above stays green on the fixture's own value.
    expect(selectsFor(db.from, 'matches')[0]).toContain('awaiting_round_advance');
  });

  it('lets the next round’s own steps through: a Halt and a Reset', async () => {
    // "Start round 2" halts a clock that still runs, then resets it.
    const running = setup({ status: 'running' }, STARTED);
    await running.clock.clockAction(BOUT, 'halt');
    expect(eventWritten(running.db)).toBe('halt');

    const halted = setup({}, HALTED);
    await halted.clock.clockAction(BOUT, 'reset_clock');
    expect(eventWritten(halted.db)).toBe('reset_clock');
  });

  it('resumes as before once the round is open: after "Start round 2", or an undo', async () => {
    const { db, clock } = setup({ awaiting_round_advance: false }, HALTED);

    await clock.clockAction(BOUT, 'resume');

    expect(eventWritten(db)).toBe('resume');
    expect(writesTo(db, 'matches')[0]?.row).toEqual({ status: 'running' });
  });

  it('resumes a single-round bout, whose row never waits', async () => {
    const { db, clock } = setup({ awaiting_round_advance: null, rounds_json: null }, HALTED);

    await clock.clockAction(BOUT, 'resume');

    expect(eventWritten(db)).toBe('resume');
  });

  it('starts a bout that is not between rounds', async () => {
    const { db, clock } = setup({ awaiting_round_advance: false, status: 'scheduled' }, IDLE);

    await clock.clockAction(BOUT, 'start');

    expect(eventWritten(db)).toBe('start');
  });
});

describe('the refusal of a clock started between two rounds', () => {
  it('answers a 400 with its own code, and says what to do', () => {
    const answer = answerOf(roundAwaitsAdvance());

    expect(answer.status).toBe(400);
    expect(answer.code).toBe('round_awaits_advance');
    expect(ROUND_AWAITS_ADVANCE).toBe('round_awaits_advance');
    expect(answer.message).toBe('Round ended — start the next round before the clock');
    expect(answer.details).toBeUndefined();
  });
});
