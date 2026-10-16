import { describe, expect, it, vi } from 'vitest';
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

const reopened = (type: 'pool' | 'single_elim') =>
  storedBout({
    phases: countdown(type),
    match_number_label: type === 'pool' ? 'L1-P1-M01' : 'QF1',
    status: 'paused',
    winner_registration_id: null,
    end_reason: null,
    red_score: 0,
    blue_score: 0,
  });

function door(type: 'pool' | 'single_elim', sheet: Array<Record<string, unknown>>) {
  const t = setup(reopened(type), sheet, RUNNING_EVENT);
  const clock = t.clock as typeof t.clock & {
    clockAction: ReturnType<typeof vi.fn>;
    latePress: ReturnType<typeof vi.fn>;
  };
  clock.clockAction = vi.fn().mockResolvedValue({ status: 'ended' });
  clock.latePress = vi.fn().mockResolvedValue({ status: 'ended' });
  return { ...t, clock };
}

describe('ScoringService — an End on a board that reads level asks the sheet first', () => {
  it.each(['pool', 'single_elim'] as const)(
    'a reopened %s bout the sheet ends goes to the fighter less far below zero',
    async (type) => {
      const { service, written, clock, matchCompletion } = door(type, BOTH_OUT);

      await service.clockAction(BOUT, 'end');

      expect(written()?.row).toMatchObject({
        status: 'completed',
        winner_registration_id: 'blue',
      });
      expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
      // The sheet ended the bout and its clock: no End on top of it.
      expect(clock.clockAction).not.toHaveBeenCalled();
    },
  );

  it("does the same for a tablet's End from its queue", async () => {
    const { service, written, clock } = door('single_elim', BOTH_OUT);
    const press = {
      clientUuid: 'p1',
      pressedAt: '2026-01-01T00:05:00.000Z',
      sentAt: '2026-01-01T00:05:01.000Z',
    };

    await service.latePress(BOUT, 'end', press);

    expect(written()?.row).toMatchObject({ status: 'completed', winner_registration_id: 'blue' });
    expect(clock.latePress).not.toHaveBeenCalled();
  });

  it('ends a bout level at time on the clock, as before', async () => {
    const { service, clock } = door('pool', LEVEL);

    await service.clockAction(BOUT, 'end');

    expect(clock.clockAction).toHaveBeenCalledWith(BOUT, 'end');
  });
});
