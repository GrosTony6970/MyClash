import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import type { SheetEnds } from './clock.service';
import {
  BOUT as PRESSED_BOUT,
  NOW,
  at,
  press,
  refusalOf,
  row,
  setup as clockSetup,
} from './clock-late-press.fixtures';
import {
  BOUT,
  hit,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * An End on a bout whose board reads level asks the sheet first.
 *
 * A bout counts down from 5. Red strikes for 3 and blue answers with an afterblow of 3: both
 * are out of points, blue less far below zero, and blue wins with the board at 0 - 0 (operator,
 * 2026-10-11). The referee presses Reopen: since ruling 331 no bout back in play keeps a winner,
 * and the sheet is not read again, so the referee can correct it first. She corrects nothing and
 * presses End. The End read the row, 0 - 0, as level: a draw in a Pool, "play sudden death" in a
 * bracket. Blue's win was gone.
 *
 * The clock asks (`SheetEnds`) only once every refusal of its door has passed: a tablet's End
 * queued before the Reopen must meet "pressed before the bout was put back in play", or it would
 * complete the bout the desk is correcting.
 */
const countdown = (type: 'pool' | 'single_elim') => ({
  type,
  tournaments: {
    ruleset_config: {
      matchFormat: {
        pointCap: 5,
        scoringDirection: 'reverse_zero_loses',
        maxDoubleHits: null,
        bestOf: { pool: 1, bracket: 1, finals: 1 },
        levelAtTime: {
          pool: [{ kind: 'draw' }],
          bracket: [{ kind: 'sudden_death' }],
          finals: [{ kind: 'sudden_death' }],
        },
      },
    },
    scoring_config_json: { afterblowMode: 'full' },
  },
});

const BOTH_OUT = [
  hit(1, 'blue', 4),
  hit(2, 'red', 3),
  { ...hit(3, 'red', 3), type: 'afterblow', afterblow_value: 3 },
];
/** Level on points at time, nobody out: the End's own question. */
const LEVEL = [hit(1, 'blue', 1), hit(2, 'red', 1)];

const reopened = (type: 'pool' | 'single_elim', board: Record<string, unknown> = {}) =>
  storedBout({
    phases: countdown(type),
    match_number_label: type === 'pool' ? 'L1-P1-M01' : 'QF1',
    status: 'paused',
    winner_registration_id: null,
    end_reason: null,
    red_score: 0,
    blue_score: 0,
    ...board,
  });

/** The `SheetEnds` the scoring door hands the clock, as the clock would ask it. */
async function sheetEndsOf(bout: Record<string, unknown>, sheet: Array<Record<string, unknown>>) {
  const t = setup(bout, sheet, RUNNING_EVENT);
  const clock = t.clock as typeof t.clock & { clockAction: ReturnType<typeof vi.fn> };
  clock.clockAction = vi.fn().mockResolvedValue({ status: 'ended' });
  await t.service.clockAction(BOUT, 'end');
  const sheetEnds = clock.clockAction.mock.calls[0]?.[6] as SheetEnds;
  return { ...t, sheetEnds };
}

describe('ScoringService — what an End on a level board asks the sheet', () => {
  it.each(['pool', 'single_elim'] as const)(
    'a reopened %s bout the sheet ends goes to the fighter less far below zero',
    async (type) => {
      const { sheetEnds, written, matchCompletion } = await sheetEndsOf(reopened(type), BOTH_OUT);

      await expect(sheetEnds(BOUT)).resolves.toBe(true);

      expect(written()?.row).toMatchObject({ status: 'completed', winner_registration_id: 'blue' });
      expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
    },
  );

  it("writes nothing when the clock refuses a tablet's End: the sheet is asked by the clock", async () => {
    const t = setup(reopened('single_elim'), BOTH_OUT, RUNNING_EVENT);
    const clock = t.clock as typeof t.clock & { latePress: ReturnType<typeof vi.fn> };
    clock.latePress = vi.fn().mockRejectedValue(new Error('pressed before the Reopen'));
    const queued = {
      clientUuid: 'p1',
      pressedAt: '2026-01-01T00:05:00.000Z',
      sentAt: '2026-01-01T00:05:01.000Z',
    };

    await expect(t.service.latePress(BOUT, 'end', queued)).rejects.toThrow(
      'pressed before the Reopen',
    );
    expect(t.written()).toBeUndefined();
  });

  it('leaves a bout level at time to the End', async () => {
    const { sheetEnds, written } = await sheetEndsOf(reopened('pool'), LEVEL);

    await expect(sheetEnds(BOUT)).resolves.toBe(false);
    expect(written()).toBeUndefined();
  });

  it('leaves a board with a leader to the End', async () => {
    const { sheetEnds, written } = await sheetEndsOf(
      reopened('pool', { red_score: 1, blue_score: 0 }),
      BOTH_OUT,
    );

    await expect(sheetEnds(BOUT)).resolves.toBe(false);
    expect(written()).toBeUndefined();
  });
});

describe('ClockService — a late End asks the sheet only after its refusals', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const RUNNING = [row(1, 'start', '10:00:00')];

  it('writes nothing when the sheet ended the bout', async () => {
    const { db, clock } = clockSetup(RUNNING);
    const sheetEnds = vi.fn().mockResolvedValue(true);

    await clock.latePress(PRESSED_BOUT, 'end', press('10:30:00'), undefined, sheetEnds);

    expect(sheetEnds).toHaveBeenCalledWith(PRESSED_BOUT, at('10:30:00'));
    expect(writesTo(db, 'match_events')).toEqual([]);
  });

  it('refuses an End pressed before the bout was put back in play, and asks nothing', async () => {
    const { clock } = clockSetup(RUNNING, { back_in_play_at: at('10:40:00') });
    const sheetEnds = vi.fn().mockResolvedValue(true);

    const refusal = await refusalOf(
      clock.latePress(PRESSED_BOUT, 'end', press('10:30:00'), undefined, sheetEnds),
    );

    expect(refusal.code).toBe('pressed_before_reopen');
    expect(sheetEnds).not.toHaveBeenCalled();
  });

  it('refuses an End on an Event that is over, and asks nothing', async () => {
    const { clock } = clockSetup(RUNNING, {}, 'completed');
    const sheetEnds = vi.fn().mockResolvedValue(true);

    const refusal = await refusalOf(
      clock.latePress(PRESSED_BOUT, 'end', press('10:30:00'), undefined, sheetEnds),
    );

    expect(refusal.code).toBe('event_results_frozen');
    expect(sheetEnds).not.toHaveBeenCalled();
  });

  it('refuses the desk End on a locked bout, and asks nothing', async () => {
    const { clock } = clockSetup(RUNNING, { locked_at: at('10:20:00') });
    const sheetEnds = vi.fn().mockResolvedValue(true);

    const refusal = await refusalOf(
      clock.clockAction(PRESSED_BOUT, 'end', undefined, undefined, false, undefined, sheetEnds),
    );

    expect(refusal.code).toBe('match_locked');
    expect(sheetEnds).not.toHaveBeenCalled();
  });
});
