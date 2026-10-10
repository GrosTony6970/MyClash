/**
 * The match clock: a list of presses, and the state they add up to.
 *
 * ONE OWNER, for the server and the scoring pad. The server folds the bout's
 * `match_events` rows. The pad folds the presses its queue still holds over the
 * server's last answer, so a bout runs with no network (operator rulings 2 and
 * 11 to 14 of the quick-win list). Two copies of these rules would let the pad
 * show a clock the server then refuses.
 *
 * A time is an ISO string, as the rows hold it: the fold keeps the row's own
 * string for `runningFrom` and `startedAt`.
 */

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

/** What a person presses on the clock. */
export type ClockAction = 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock';

/** The four presses a pad may make with no network, and send later (ruling 13). */
export type ClockPress = 'start' | 'halt' | 'resume' | 'end';

/** Every row that moves the clock: a press, a time correction, a reset of the bout. */
export type ClockMoveType = ClockAction | 'adjust_time' | 'reset_match';

export interface ClockMove {
  type: ClockMoveType;
  occurredAt: string;
  /** Of an `adjust_time` row only. */
  adjustmentMs?: number | null;
}

export interface ClockFold {
  status: ClockStatus;
  /** The time the clock has run, without the interval that still runs. */
  activeMs: number;
  /** While running: the time of the press that started the interval. */
  runningFrom: string | null;
  /** The time of the first Start since the bout's last reset. */
  startedAt: string | null;
}

export const IDLE_CLOCK: ClockFold = {
  status: 'idle',
  activeMs: 0,
  runningFrom: null,
  startedAt: null,
};

/** The clock with the interval that runs closed at `at`. */
function closed(clock: ClockFold, at: string): Pick<ClockFold, 'activeMs' | 'runningFrom'> {
  if (!clock.runningFrom) return { activeMs: clock.activeMs, runningFrom: null };
  const ran = new Date(at).getTime() - new Date(clock.runningFrom).getTime();
  return { activeMs: clock.activeMs + ran, runningFrom: null };
}

/**
 * The clock after one row. It does not ask whether the row was legal: the
 * write does (`CLOCK_ACTIONS_FROM`), and a row that is saved is replayed.
 */
export function clockStep(clock: ClockFold, move: ClockMove): ClockFold {
  switch (move.type) {
    case 'start':
      return {
        ...clock,
        status: 'running',
        runningFrom: move.occurredAt,
        startedAt: clock.startedAt ?? move.occurredAt,
      };
    case 'halt':
      return { ...clock, ...closed(clock, move.occurredAt), status: 'halted' };
    case 'resume':
      return { ...clock, status: 'running', runningFrom: move.occurredAt };
    case 'end':
      return { ...clock, ...closed(clock, move.occurredAt), status: 'ended' };
    case 'reopen':
      // The inverse of End: the time is kept, and the referee resumes or ends again.
      return { ...clock, runningFrom: null, status: 'halted' };
    case 'reset_clock':
      return { ...clock, activeMs: 0, runningFrom: null, status: 'halted' };
    case 'adjust_time':
      return { ...clock, activeMs: Math.max(0, clock.activeMs + (move.adjustmentMs ?? 0)) };
    case 'reset_match':
      return IDLE_CLOCK;
  }
}

/** The clock a list of rows adds up to, in the order given. */
export function foldClock(moves: readonly ClockMove[]): ClockFold {
  return moves.reduce(clockStep, IDLE_CLOCK);
}

/** What a person may press from each state of the clock. */
export const CLOCK_ACTIONS_FROM: Record<ClockStatus, readonly ClockAction[]> = {
  idle: ['start'],
  running: ['halt', 'end'],
  halted: ['resume', 'end', 'reset_clock'],
  ended: ['reopen'],
};

/** Ruling 12: the states of the clock in which a press asks for what is already true. */
const PRESS_ALREADY_TRUE: Record<ClockPress, readonly ClockStatus[]> = {
  start: ['running', 'halted'],
  halt: ['halted', 'ended'],
  resume: ['running'],
  end: ['ended'],
};

/** Does the press ask for the state the clock is in? It is then taken as done. */
export const pressAlreadyTrue = (press: ClockPress, status: ClockStatus): boolean =>
  PRESS_ALREADY_TRUE[press].includes(status);

/**
 * The clock after a press the pad still holds, as the server will take it
 * (ruling 12): a press that is already true changes nothing, a press that fits
 * is applied, and a press that fits nothing changes nothing here. The server
 * refuses that last one, and the pad then holds it.
 */
export function clockAfterPress(clock: ClockFold, press: ClockPress, at: string): ClockFold {
  if (pressAlreadyTrue(press, clock.status)) return clock;
  if (!CLOCK_ACTIONS_FROM[clock.status].includes(press)) return clock;
  return clockStep(clock, { type: press, occurredAt: at });
}
