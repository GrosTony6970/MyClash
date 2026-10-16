import { describe, expect, it } from 'vitest';
import {
  BOUT,
  ENDED,
  HALTED,
  RUNNING,
  refusalOf,
  setup,
  wroteNothing,
} from './clock-late-press.fixtures';

/**
 * `keepsCompleted`: a clock step of another door (the round advance, the series Halt after a
 * round closes) on a bout a forfeit completed meanwhile. Without it, a Halt or a Reopen
 * un-completed the bout and voided the forfeit, and a Reset put a completed bout's clock back to
 * zero. Refused before every other rule, so the caller always reads `bout_completed`.
 */
const FORFEITED = { status: 'completed', winner_registration_id: 'red', end_reason: 'forfeit' };
const STEP = { canOverrideLocked: true, keepsCompleted: true };

describe('ClockService.clockAction — a step that keeps a completed bout', () => {
  it.each([
    ['a Halt of a running clock', RUNNING, 'halt'],
    ['a Reopen of an ended clock', ENDED, 'reopen'],
    ['a Reset of a halted clock', HALTED, 'reset_clock'],
    // The transition table refuses this one with a 400 the advance read as a fault.
    ['a Reset of an ended clock', ENDED, 'reset_clock'],
  ] as const)('refuses %s, and un-completes nothing', async (_, events, action) => {
    const { db, completion, clock } = setup(events, FORFEITED);

    expect(await refusalOf(clock.clockAction(BOUT, action, 'step', STEP))).toEqual({
      status: 409,
      code: 'bout_completed',
    });
    expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
    wroteNothing(db);
  });

  it('lets an End through: it stops the clock and keeps the result', async () => {
    const { completion, clock } = setup(RUNNING, FORFEITED);

    await expect(clock.clockAction(BOUT, 'end', 'step', STEP)).resolves.toMatchObject({
      matchId: BOUT,
    });
    expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
  });
});
