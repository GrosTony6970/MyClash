import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor } from '../../common/testing/supabase-chain';
import { BOUT, hit, phase, setup, storedBout } from './scoring.service.corrections.fixtures';

/**
 * A bout a hit sent late decides ends at the time of that hit, not at the time its queue arrives.
 *
 * The clock's End already stops a running clock at the hit's time, and writes it as the bout's
 * end. A clock that never ran has no End to give: the bout's `ended_at` was the arrival of the
 * tablet's queue, an hour later on a tablet that came back from no wifi.
 */
const NOW = '2026-01-01T11:00:00.000Z';
/** The server's time of the hit at the cap, sent late. */
const CAUSED_AT = '2026-01-01T10:06:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

const capOf7 = (bestOf: number) => ({
  ...phase('single_elim'),
  tournaments: {
    ruleset_config: {
      matchFormat: { pointCap: 7, bestOf: { pool: bestOf, bracket: bestOf, finals: bestOf } },
    },
    scoring_config_json: null,
  },
});
const TO_THE_CAP = [hit(1, 'red', 3), hit(2, 'red', 3), hit(3, 'red', 1)];
const running = { status: 'running', winner_registration_id: null, end_reason: null };

describe('ScoringService.recomputeMatchScore — the end time of a bout decided late', () => {
  it('a single fight ends at the time of the hit that decided it', async () => {
    const { service, clock, written } = setup(
      storedBout({ ...running, phases: capOf7(1) }),
      TO_THE_CAP,
    );
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: CAUSED_AT });
  });

  it('a series ends at the time of the hit that won it', async () => {
    const { service, clock, written } = setup(
      storedBout({
        ...running,
        phases: capOf7(3),
        match_number_label: 'QF1',
        current_round: 2,
        rounds_json: [
          { round: 1, redScore: 7, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
        ],
        red_round_wins: 1,
        blue_round_wins: 0,
      }),
      TO_THE_CAP.map((row) => ({ ...row, round_number: 2 })),
    );
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: CAUSED_AT });
  });

  // The desk put the bout back in play at 10:30; a hit made at 10:06 arrives after and decides
  // it. The bout cannot end before it was last put back in play, or before it started.
  it('never ends before the bout was put back in play, or started', async () => {
    const reopened = '2026-01-01T10:30:00.000Z';
    const { db, service, clock, written } = setup(
      storedBout({ ...running, phases: capOf7(1), back_in_play_at: reopened }),
      TO_THE_CAP,
    );
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: reopened });
    // The double answers every column it holds: the read must ask for both marks.
    const select = selectsFor(db.from, 'matches')[0];
    expect(select).toContain('back_in_play_at');
    expect(select).toContain('started_at');
  });

  // The clock started at 10:20 on a tablet with a network; a hit made at 10:06 on the clock of
  // another tablet arrives and decides it.
  it('a single fight never ends before it started', async () => {
    const started = '2026-01-01T10:20:00.000Z';
    const { service, clock, written } = setup(
      storedBout({ ...running, phases: capOf7(1), started_at: started }),
      TO_THE_CAP,
    );
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: started });
  });

  it('a series never ends before it was put back in play', async () => {
    const reopened = '2026-01-01T10:30:00.000Z';
    const { service, clock, written } = setup(
      storedBout({
        ...running,
        phases: capOf7(3),
        match_number_label: 'QF1',
        current_round: 2,
        rounds_json: [
          { round: 1, redScore: 7, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
        ],
        red_round_wins: 1,
        blue_round_wins: 0,
        back_in_play_at: reopened,
      }),
      TO_THE_CAP.map((row) => ({ ...row, round_number: 2 })),
    );
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: reopened });
  });

  it('a bout decided by a person with a network ends now', async () => {
    const { service, written } = setup(storedBout({ ...running, phases: capOf7(1) }), TO_THE_CAP);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ status: 'completed', ended_at: NOW });
  });
});
