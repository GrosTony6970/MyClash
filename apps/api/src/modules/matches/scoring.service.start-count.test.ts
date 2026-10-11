import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';

/**
 * The two doors of a clock Start count the score of a bout that starts
 * (operator, 2026-10-11). WHEN the count runs and how it is proved is
 * `start-count.test.ts`; this is that both doors reach it, after the clock.
 *
 * The tablet sends every Start through its queue, with an id: `latePress`. A
 * count that did not land there is an error, so the tablet sends the Start
 * again. `clockAction` is the door of a press with no id, pressed by a person
 * with a network: its count is best effort, as the rest of that door.
 */
const BOUT = 'm1';
const PRESS = {
  clientUuid: 'a0000000-0000-4000-8000-0000000000aa',
  pressedAt: '2026-10-11T10:00:00.000Z',
  sentAt: '2026-10-11T10:00:01.000Z',
};
const ACTOR = { userId: 'u1' };
const RUNNING = { status: 'running' };
const row = (status: string, red: number, blue: number) => ({
  data: {
    id: BOUT,
    status,
    red_score: red,
    blue_score: blue,
    phases: { tournaments: { events: { status: 'running' } } },
  },
  error: null,
});
const NOTHING = { rows: [] };

function setup(matches: unknown) {
  const db = mockSupabase({
    matches,
    exchanges: NOTHING,
    match_penalties: NOTHING,
    match_forfeits: NOTHING,
  } as never);
  const steps: string[] = [];
  const clock = {
    latePress: vi.fn(async () => {
      steps.push('clock');
      return RUNNING;
    }),
    clockAction: vi.fn(async () => {
      steps.push('clock');
      return RUNNING;
    }),
    getClockState: vi.fn(),
  };
  const scoring = new ScoringService(db as never, undefined as never, clock as never);
  const recompute = vi.spyOn(scoring, 'recomputeMatchScore').mockImplementation(async () => {
    steps.push('count');
    return { redScore: 5, blueScore: 5 };
  });
  return { db, clock, scoring, recompute, steps };
}

/** Started a moment ago: 0 - 0 before the count, cap to cap after it. */
const STARTED = [row('running', 0, 0), row('running', 5, 5)];

afterEach(() => vi.restoreAllMocks());

describe('ScoringService.latePress — a Start from a tablet’s queue', () => {
  it('counts the score after the clock has taken the Start', async () => {
    const { clock, scoring, steps } = setup(STARTED);

    await expect(scoring.latePress(BOUT, 'start', PRESS, ACTOR)).resolves.toBe(RUNNING);

    expect(clock.latePress.mock.calls).toEqual([[BOUT, 'start', PRESS, ACTOR]]);
    expect(steps).toEqual(['clock', 'count']);
  });

  it.each(['halt', 'resume', 'end'] as const)('counts nothing at a %s', async (action) => {
    const { db, clock, scoring, recompute } = setup(STARTED);

    await expect(scoring.latePress(BOUT, action, PRESS, ACTOR)).resolves.toBe(RUNNING);

    expect(clock.latePress.mock.calls).toEqual([[BOUT, action, PRESS, ACTOR]]);
    expect(recompute).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('counts nothing when the clock refuses the Start', async () => {
    const { db, clock, scoring, recompute } = setup(STARTED);
    clock.latePress.mockRejectedValue(new Error('refused'));

    await expect(scoring.latePress(BOUT, 'start', PRESS, ACTOR)).rejects.toThrow('refused');

    expect(recompute).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('answers an error when the count did not land: the tablet sends the Start again', async () => {
    // The row still reads 0 - 0 after the count, over an empty sheet.
    const { clock, scoring } = setup(row('running', 0, 0));

    await expect(scoring.latePress(BOUT, 'start', PRESS, ACTOR)).rejects.toThrow(
      'was not counted at its Start',
    );
    // The press itself was taken. The next send finds it saved, the clock
    // answers it as it is, and the count runs again: it asks the bout's row
    // and its sheet, not whether the press is new (`start-count.test.ts`).
    expect(clock.latePress).toHaveBeenCalledTimes(1);
  });
});

describe('ScoringService.clockAction — a Start with no id', () => {
  it('counts the score of a bout that starts, after the clock', async () => {
    // The door reads the bout first (is a forfeit record holding it?): scheduled.
    const { scoring, steps } = setup([row('scheduled', 0, 0), ...STARTED]);

    await expect(scoring.clockAction(BOUT, 'start', undefined, ACTOR)).resolves.toBe(RUNNING);

    expect(steps).toEqual(['clock', 'count']);
  });

  it.each(['halt', 'resume', 'reopen'] as const)('counts nothing at a %s', async (action) => {
    const { scoring, recompute } = setup(row('running', 0, 0));

    await scoring.clockAction(BOUT, action, undefined, ACTOR);

    expect(recompute).not.toHaveBeenCalled();
  });

  it('is best effort: a count that did not land is logged, and the Start is answered', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { scoring } = setup(row('running', 0, 0));

    await expect(scoring.clockAction(BOUT, 'start', undefined, ACTOR)).resolves.toBe(RUNNING);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Match ${BOUT} was started with its score not counted`),
      expect.any(Error),
    );
  });
});
