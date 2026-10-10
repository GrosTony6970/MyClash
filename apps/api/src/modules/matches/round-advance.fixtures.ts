import { vi } from 'vitest';
import { HALTED, PRESS, press, row, setup } from './clock-late-press.fixtures';
import { ScoringService } from './scoring.service';

/**
 * "Start round N+1", sent late by a tablet (operator, 2026-10-10).
 *
 * A best-of-3 bout, no wifi from 10:00 to 11:00. Round 1 ends at 10:00:30. The
 * official taps "Start round 2" at 10:05 and the table fights on. At 11:00 the
 * tablet sends its queue: the server opens round 2 once, at 10:05, so that the
 * clock presses of round 2 behind it keep their own times.
 */
export const STAFF = { staffAccountId: 'staff-1' };
/** Round 1 is closed, and the server halted its clock at 10:00:30. */
export const WAITS = { status: 'paused', current_round: 1, awaiting_round_advance: true };
/** Somebody opened round 2. */
export const OPEN = { status: 'paused', current_round: 2, awaiting_round_advance: false };
export const SAVED = row(3, 'round_advance', '10:05:00', { client_uuid: PRESS });

/** A "Start round `round`" tapped at `pressed` and sent at 11:00. */
export const advance = (pressed: string, round = 2, skewMinutes = 0) => ({
  ...press(pressed, skewMinutes),
  round,
});

export function series(
  events = HALTED,
  bout: Record<string, unknown> = WAITS,
  eventStatus = 'running',
) {
  const { db, rows, clock } = setup(events, bout, eventStatus);
  const scoring = new ScoringService(db as never, undefined as never, clock as never);
  const recompute = vi
    .spyOn(scoring, 'recomputeMatchScore')
    .mockResolvedValue({ redScore: 0, blueScore: 0 });
  return { db, rows, clock, scoring, recompute };
}

export const written = (db: ReturnType<typeof series>['db']) =>
  db.writes.map((write) => `${write.table} ${(write.row as { type?: string }).type ?? write.op}`);
