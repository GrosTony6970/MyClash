import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';
import { phase } from './scoring.service.corrections.fixtures';

/**
 * A forfeit taken back reopens the clock it ended (operator ruling 2026-10-16, "Forfeit back").
 *
 * Marc was forfeited by mistake in the middle of his bout, and the organiser took it back. The
 * bout came back "running", but the forfeit had ended its clock: the tablet showed a running bout
 * with a frozen clock and only a Reopen button, and a series then won on hits never moved its
 * winner on. The take-back now reopens the clock, and the bout waits "paused" for the referee's
 * Resume.
 */
const BOUT = 'm1';
const RESULT = { status: 'completed', red_score: 0, blue_score: 6, end_reason: 'forfeit' };

/** The forfeited bout and its record, which found the bout as `previous`. */
const seeded = (previous: Record<string, unknown>) =>
  mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          locked_at: null,
          match_number_label: 'P1M1',
          phases: phase('pool'),
          winner_registration_id: 'blue',
          ...RESULT,
        },
      ],
    },
    match_forfeits: {
      rows: [
        {
          id: 'forfeit-1',
          match_id: BOUT,
          parent_forfeit_id: null,
          forfeiting_registration_id: 'red',
          downstream_match_ids: [],
          voided_at: null,
          previous_match_state: previous,
          previous_registration_state: {},
          resulting_match_state: { ...RESULT, winner_registration_id: 'blue' },
        },
      ],
    },
    exchanges: { rows: [] },
    match_penalties: { rows: [] },
  });

function service(previous: Record<string, unknown>, clockStatus: string) {
  const db = seeded(previous);
  const steps: string[] = [];
  const clock = {
    getClockState: vi.fn().mockResolvedValue({ status: clockStatus }),
    clockAction: vi.fn(async (_id: string, action: string) => {
      steps.push(`clock ${action}`);
      return { status: 'halted' };
    }),
  };
  const scoring = {
    recomputeMatchScore: vi.fn(async () => {
      steps.push('sheet');
    }),
  };
  const forfeits = new MatchForfeitsService(
    db as never,
    undefined as never,
    clock as never,
    undefined as never,
    undefined as never,
    scoring as never,
  );
  return { db, clock, steps, forfeits };
}

describe('MatchForfeitsService.voidForfeit — the clock the forfeit ended', () => {
  it.each(['running', 'paused'])(
    'a bout forfeited while %s gets its clock reopened, then reads its sheet',
    async (found) => {
      const { clock, steps, forfeits } = service({ status: found, red_score: 3 }, 'ended');

      await forfeits.voidForfeit('forfeit-1');

      expect(clock.clockAction).toHaveBeenCalledWith(BOUT, 'reopen', 'auto: forfeit taken back', {
        canOverrideLocked: true,
      });
      expect(steps).toEqual(['clock reopen', 'sheet']);
    },
  );

  it('leaves a clock alone that the forfeit did not end', async () => {
    const { clock, forfeits } = service({ status: 'running' }, 'running');

    await forfeits.voidForfeit('forfeit-1');

    expect(clock.clockAction).not.toHaveBeenCalled();
  });

  it.each(['scheduled', 'completed'])(
    'leaves the clock of a bout put back %s alone',
    async (found) => {
      const { clock, forfeits } = service({ status: found }, 'ended');

      await forfeits.voidForfeit('forfeit-1');

      expect(clock.clockAction).not.toHaveBeenCalled();
    },
  );

  it('a Reopen that fails leaves the take-back done, and says so', async () => {
    const { db, clock, forfeits } = service({ status: 'running' }, 'ended');
    clock.clockAction.mockRejectedValue(new Error('clock down'));

    await expect(forfeits.voidForfeit('forfeit-1')).resolves.toBeDefined();
    expect(writesTo(db, 'match_forfeits')).toHaveLength(1);
  });
});
