/**
 * The clock the bout's screen shows: the server's last answer, plus the clock
 * presses this tablet still holds, folded by the rules the server uses
 * (`clockAfterPress`, operator rulings 11 to 14 of the quick-win list).
 *
 * A press acts on the screen at once and is sent behind (ruling A of
 * 2026-10-10), so with a network the queue holds a press for a moment, and
 * with none for as long as the hall has none. Either way the clock on screen
 * is the one the server will have once the queue is sent.
 *
 * Pure: no store, no React. The caller gives the rows.
 */
import { clockAfterPress, type ClockFold, type ClockStatus } from '@myclash/types';
import type { ClockState } from '../components/scoreboard-clock';
import { kindOf, type OutboxEntry } from './db';

const IDLE: ClockFold = { status: 'idle', activeMs: 0, runningFrom: null, startedAt: null };

/** The clock presses of the queue's rows, in the order they were made. */
export function pressesOf(rows: readonly OutboxEntry[]): OutboxEntry[] {
  return rows.filter((row) => kindOf(row) === 'press').sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * The clock on the pad.
 *
 * `server` is null when no read of the clock has landed, on a bout opened with
 * no network and no copy of its clock. With presses to fold the clock then
 * starts from idle: the first press of a bout is a Start, and a Start the
 * server already had is taken as done there (ruling 12). With none, the clock
 * is not known, and null says so.
 *
 * `sent` holds the presses the server has answered. The engine tells the
 * screen the answer BEFORE the press leaves the queue, so for a moment the
 * answer and the queue both hold it: it must not be folded twice.
 */
export function padClock(
  matchId: string,
  server: ClockState | null,
  presses: readonly OutboxEntry[],
  sent: ReadonlySet<string>,
): ClockState | null {
  const waiting = presses.filter((press) => !sent.has(press.clientUuid));
  if (waiting.length === 0) return server;

  let clock: ClockFold = server ?? IDLE;
  for (const press of waiting) {
    if (press.pressAction) clock = clockAfterPress(clock, press.pressAction, press.occurredAt);
  }
  return {
    matchId,
    events: server?.events,
    levelResolutionSteps: server?.levelResolutionSteps,
    status: clock.status,
    activeMs: clock.activeMs,
    runningFrom: clock.runningFrom,
    // Not read on the pad: the screen adds the interval that runs by itself.
    totalActiveMs: clock.activeMs,
    startedAt: clock.startedAt,
  };
}

/**
 * The bout's status for the scoring buttons.
 *
 * The buttons were live from the server's row alone, so a bout this tablet
 * started with no network could not be scored. A bout in play follows the
 * clock on the pad. A bout the server says is completed or voided stays that:
 * only a person re-opens a bout, with a network.
 */
export function boutStatusOnPad(serverStatus: string, clock: ClockStatus): string {
  const inPlay =
    serverStatus === 'scheduled' || serverStatus === 'running' || serverStatus === 'paused';
  if (!inPlay) return serverStatus;
  switch (clock) {
    case 'running':
      return 'running';
    case 'halted':
      return 'paused';
    case 'ended':
      return 'completed';
    case 'idle':
      return serverStatus;
  }
}

/**
 * The result screen is up (the clock is ended), and the server's row does not
 * say "completed" yet: the End is on the tablet, or it was just answered and
 * the bout is not read again. The result is then the tablet's own, and the
 * screen says "not confirmed" (ruling 11).
 */
export function resultUnconfirmed(serverStatus: string, clock: ClockStatus): boolean {
  return clock === 'ended' && serverStatus !== 'completed';
}

/** The score an End was pressed on, and the bout it ended. */
export interface EndScore {
  matchId: string;
  red: number;
  blue: number;
}

/**
 * The score of the End the queue holds, or the one this screen saw before:
 * the End leaves the queue when the server takes it, and the result screen
 * still needs its score until the bout is read again.
 */
export function endScoreOf(
  presses: readonly OutboxEntry[],
  before: EndScore | null,
): EndScore | null {
  const end = presses.find((row) => row.pressAction === 'end' && row.endScore);
  return end?.endScore ? { matchId: end.matchId, ...end.endScore } : before;
}

/**
 * The score of a result that is not confirmed: the score "End match" was
 * pressed on, when this screen saw that press. The score on the screen moves
 * while the queue goes out (a hit the server took leaves the queue before the
 * bout is read again), so it is the fallback only, for a result this screen
 * did not see pressed.
 */
export function tabletResult(
  pressedOn: { red: number; blue: number } | null,
  onScreen: { red: number; blue: number },
): { red: number; blue: number } {
  return pressedOn ?? onScreen;
}
