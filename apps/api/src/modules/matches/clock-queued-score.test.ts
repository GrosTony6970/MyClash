import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { BOUT, HALTED, NOW, RUNNING, at, row, setup } from './clock-late-press.fixtures';
import { scoredAtServer } from './late-press';
import { MatchForfeitsService } from './match-forfeits.service';

/**
 * The server's own End or Halt, after a hit or a card a tablet kept in its
 * queue (the offline bout, slice 3).
 *
 * A table has no wifi from 10:00 to 11:00. The clock runs since 10:00. At 10:20
 * the official gives a black card, which ends the bout. The card reaches the
 * server at 11:00, and the server ends the clock by itself. It ended it at
 * 11:00: the bout read 60 minutes of fight, where it had 20.
 *
 * The tablet now sends, with a hit or a card, how old it is. The server's own
 * press is written that long ago, never at the time of arrival.
 */
const CARD_AT = at('10:20:00');
const TWENTY_MINUTES = 20 * 60_000;
const OPENS_THE_LOCK = { canOverrideLocked: true };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A card given at 10:20 and sent at 11:00, on a tablet whose clock is `skewMinutes` wrong. */
function cardOf(skewMinutes: number) {
  const tablet = (iso: string) => new Date(Date.parse(iso) + skewMinutes * 60_000).toISOString();
  return { occurredAt: tablet(CARD_AT), sentAt: tablet(NOW) };
}

describe('the server’s time of a hit or a card from a tablet’s queue', () => {
  it.each([
    ['whose clock is right', 0],
    ['whose clock is an hour ahead', 60],
    ['whose clock is an hour behind', -60],
  ])('is how long ago it was made, on a tablet %s', (_, skew) => {
    expect(scoredAtServer(cardOf(skew))).toBe(CARD_AT);
  });

  it('is none for the pad of before, which sends no send time', () => {
    expect(scoredAtServer({ occurredAt: CARD_AT })).toBeUndefined();
  });

  it('a send dated before its hit is a hit of now', () => {
    expect(scoredAtServer({ occurredAt: at('10:50:00'), sentAt: at('10:10:00') })).toBe(NOW);
  });
});

describe('the server’s own press, placed at the time of what caused it', () => {
  // The card completed the bout first, as a forfeit and the points cap do.
  const DECIDED = { status: 'completed', winner_registration_id: 'blue', end_reason: 'black_card' };

  it('an End is written at that time, with the time the clock had run then', async () => {
    const { db, clock } = setup(RUNNING, DECIDED);

    await clock.clockAction(BOUT, 'end', 'auto: forfeit', OPENS_THE_LOCK, false, CARD_AT);

    const [written] = writesTo(db, 'match_events');
    expect(written?.row).toEqual({
      match_id: BOUT,
      sequence: 2,
      type: 'end',
      reason: 'auto: forfeit',
      by_user_id: null,
      staff_account_id: null,
      occurred_at: CARD_AT,
    });
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'completed',
      ended_at: CARD_AT,
      duration_active_ms: TWENTY_MINUTES,
      duration_total_ms: TWENTY_MINUTES,
    });
  });

  it('an End on a clock that is paused adds no time, and ends the bout at that time', async () => {
    const { db, clock } = setup(HALTED, DECIDED);

    await clock.clockAction(BOUT, 'end', 'auto: match complete', OPENS_THE_LOCK, false, CARD_AT);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: CARD_AT });
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'completed',
      ended_at: CARD_AT,
      duration_active_ms: 30_000,
      duration_total_ms: TWENTY_MINUTES,
    });
  });

  it('a Halt is written at that time', async () => {
    const { db, clock } = setup(RUNNING);

    await clock.clockAction(BOUT, 'halt', 'auto: round over', OPENS_THE_LOCK, false, CARD_AT);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'halt',
      occurred_at: CARD_AT,
    });
  });

  it('is never before the row the bout ends with', async () => {
    // Another tablet resumed the clock at 10:45. An End placed at 10:20 would
    // come before that Resume, and the clock would read as still running.
    const resumed = [...RUNNING, row(2, 'halt', '10:10:00'), row(3, 'resume', '10:45:00')];
    const { db, clock } = setup(resumed, DECIDED);

    await clock.clockAction(BOUT, 'end', 'auto: forfeit', OPENS_THE_LOCK, false, CARD_AT);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 4,
      occurred_at: at('10:45:00'),
    });
    expect(filtersFor(db.from, 'match_events', 'order')).toContainEqual([
      'occurred_at',
      { ascending: false },
    ]);
    // Ten minutes ran before the Halt, and none after the Resume.
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ duration_active_ms: 10 * 60_000 });
  });

  it('with no such time it is written now, as before', async () => {
    const { db, clock } = setup(RUNNING, DECIDED);

    await clock.clockAction(BOUT, 'end', 'auto: forfeit', OPENS_THE_LOCK);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: NOW });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      ended_at: NOW,
      duration_active_ms: 60 * 60_000,
    });
    // The timeline's last row is read for a placed press only.
    expect(filtersFor(db.from, 'match_events', 'order')).not.toContainEqual([
      'occurred_at',
      { ascending: false },
    ]);
  });
});

/** One bout row for the two readers: the forfeit's and the clock's. */
const FORFEITED_BOUT = {
  id: BOUT,
  phase_id: 'phase-1',
  pool_id: 'pool-1',
  bracket_slot_id: null,
  status: 'running',
  locked_at: null,
  started_at: at('10:00:00'),
  rounds_json: null,
  current_round: 1,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  winner_registration_id: null,
  red_score: 2,
  blue_score: 3,
  match_number_label: 'P1M1',
  awaiting_round_advance: false,
  phases: {
    id: 'phase-1',
    type: 'pool',
    tournament_id: 'tournament-1',
    config_json: {},
    tournaments: { id: 'tournament-1', ruleset_config: {}, events: { status: 'running' } },
  },
};

/**
 * The forfeit hands its time to the real clock. The double does not apply the
 * forfeit's own write, so the clock reads the bout as still running: what a
 * placed End writes on a bout already decided is held by the block above.
 */
describe('a black card given with no network while the clock runs', () => {
  function forfeitOn(timeline: TableSeed = { rows: RUNNING }) {
    const db = mockSupabase({
      matches: { rows: [FORFEITED_BOUT] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      match_events: timeline,
    });
    const forfeits = new MatchForfeitsService(
      db as never,
      undefined as never,
      new ClockService(db as never),
    );
    const blackCard = (causedAt?: string) =>
      forfeits.createForfeit(
        BOUT,
        { forfeitingRegistrationId: 'reg-red', reason: 'black_card_1', canContinue: true },
        { staffAccountId: 'pad-1' },
        causedAt,
      );
    return { db, blackCard };
  }

  /** The clock's own write to the bout: the one that carries the time fought. */
  const clockWrite = (db: ReturnType<typeof forfeitOn>['db']) =>
    writesTo(db, 'matches')
      .map((write) => write.row as Record<string, unknown>)
      .find((written) => 'duration_active_ms' in written);

  it('ends the clock at the time of the card, not at the time of arrival', async () => {
    const { db, blackCard } = forfeitOn();

    await blackCard(CARD_AT);

    expect(writesTo(db, 'match_events').map((write) => write.row)).toEqual([
      expect.objectContaining({ type: 'end', reason: 'auto: forfeit', occurred_at: CARD_AT }),
    ]);
    expect(clockWrite(db)).toMatchObject({
      ended_at: CARD_AT,
      duration_active_ms: TWENTY_MINUTES,
    });
  });

  it('a forfeit a person records at the table ends the clock now', async () => {
    const { db, blackCard } = forfeitOn();

    await blackCard();

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ type: 'end', occurred_at: NOW });
    expect(clockWrite(db)).toMatchObject({ ended_at: NOW, duration_active_ms: 60 * 60_000 });
  });

  it('a clock that cannot be read does not undo the forfeit, and it is said', async () => {
    const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db, blackCard } = forfeitOn({ data: null, error: { message: 'timeout' } });

    await expect(blackCard(CARD_AT)).resolves.toMatchObject({ id: 'forfeit-1' });

    expect(writesTo(db, 'match_events')).toEqual([]);
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ status: 'completed' });
    expect(warned).toHaveBeenCalledWith(
      `Clock end skipped after the forfeit of match ${BOUT}`,
      expect.anything(),
    );
  });
});
