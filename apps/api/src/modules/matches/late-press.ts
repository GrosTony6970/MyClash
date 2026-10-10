import { BadRequestException, ConflictException } from '@nestjs/common';
import { pressAlreadyTrue } from '@myclash/rules';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ClockAction, ClockState } from './clock.service';
import { assertScoredAfterLastReset } from './hit-before-reset';
import { matchLocked } from './match-locked';
import { roundAwaitsAdvance } from './round-awaits-advance';
import { asRow } from './time-limit-result';

type Database = SupabaseService['service'];

/**
 * A clock press a pad made with no network, and sends later (operator rulings
 * 11 to 14 of the quick-win list, 2026-10-09).
 *
 * The pad gives each press an id, as it does for a hit, and sends its own time
 * of the press and of the send. `ClockService.latePress` is the door. A press
 * with no id is the pad of before, and goes through `clockAction` unchanged.
 */
export const PRESS_ACTIONS = ['start', 'halt', 'resume', 'end'] as const;
export type PressAction = (typeof PRESS_ACTIONS)[number];

export interface LatePress {
  /** The id the pad gave the press. A second send of it is answered, never written again. */
  clientUuid: string;
  /** The pad's time of the press, and of this send. Only their difference is read. */
  pressedAt: string;
  sentAt: string;
}

const isPressAction = (action: ClockAction): action is PressAction =>
  (PRESS_ACTIONS as readonly string[]).includes(action);

/**
 * The press a clock body names, or null for a body of the pad of before.
 *
 * A body names all three fields or none: half a press written as a press of
 * now would lose its id, and its second send would count twice. Reopen and
 * Reset are a person's, with a network (ruling 13).
 */
export function latePressOf(body: {
  action: ClockAction;
  clientUuid?: string;
  pressedAt?: string;
  sentAt?: string;
}): (LatePress & { action: PressAction }) | null {
  const { action, clientUuid, pressedAt, sentAt } = body;
  if (clientUuid === undefined && pressedAt === undefined && sentAt === undefined) return null;
  if (!clientUuid || !pressedAt || !sentAt || !isPressAction(action)) {
    throw new BadRequestException(
      'A press with an id is a start, a halt, a resume or an end, and names its id, ' +
        'the time of the press and the time of the send',
    );
  }
  return { action, clientUuid, pressedAt, sentAt };
}

/**
 * The status of the bout's Event, off the `events(status)` embed of the clock's
 * read. A row that does not carry it is an error: "could not read" must not
 * pass as "the Event is open".
 */
export function eventStatusOf(match: Record<string, unknown>): string {
  const tournament = asRow(asRow(match['phases'])?.['tournaments']);
  const status = asRow(tournament?.['events'])?.['status'];
  if (typeof status !== 'string') {
    throw new Error(`Could not read the Event of bout ${String(match['id'])}`);
  }
  return status;
}

/**
 * Ruling 12: does the press ask for the state the clock is in? It is then
 * taken as done. The pad folds its own queue by the same rule.
 */
export const alreadyTrue = pressAlreadyTrue;

/**
 * The server's time of the press: how OLD the press is, taken off the server's
 * own clock. The time of day the pad says is never read, so a pad an hour wrong
 * gives the same answer. A send dated before its press is a press of now.
 */
export function pressedAtServer(
  press: Pick<LatePress, 'pressedAt' | 'sentAt'>,
  nowMs: number,
): number {
  return nowMs - Math.max(0, Date.parse(press.sentAt) - Date.parse(press.pressedAt));
}

/**
 * The server's time of a hit or a card a pad kept in its queue, read as the
 * time of a press is: by its age. A hit or a card can decide the bout, and the
 * server then stops the clock by itself: that End or Halt is written at this
 * time, not at the time the queue arrives (`ClockService.clockAction`).
 *
 * None for the pad of before, which sends no `sentAt`: the server's press is
 * then of now, as it was. The hit's own row keeps the pad's `occurredAt`.
 *
 * None also for an age over one day (operator, 2026-10-10): a tablet whose
 * time of day is corrected between the hit and the send says an age that is
 * wrong, and an End placed that far back takes the last run of the clock off
 * the bout. The hit itself is taken: only a clock press is refused by its age.
 */
export function scoredAtServer(scored: {
  occurredAt: string;
  sentAt?: string;
}): string | undefined {
  if (!scored.sentAt) return undefined;
  const nowMs = Date.now();
  const scoredMs = pressedAtServer({ pressedAt: scored.occurredAt, sentAt: scored.sentAt }, nowMs);
  if (nowMs - scoredMs > OLDEST_PRESS_MS) return undefined;
  return new Date(scoredMs).toISOString();
}

/** Where the press goes in the bout's timeline: never before the row the bout ends with. */
export function placedAt(pressedMs: number, lastRowAt: string | null): string {
  const floor = lastRowAt ? Date.parse(lastRowAt) : pressedMs;
  return new Date(Math.max(pressedMs, floor)).toISOString();
}

/** The time the clock had run at `at`, the interval that still runs included. */
export function elapsedAt(clock: ClockState, at: string): number {
  if (clock.status !== 'running' || !clock.runningFrom) return clock.activeMs;
  return clock.activeMs + Math.max(0, Date.parse(at) - Date.parse(clock.runningFrom));
}

/** The code of `ClockRowCollided`. */
export const CLOCK_ROW_COLLIDED = 'clock_row_collided';

/**
 * Another writer took the sequence this press read, or saved this press, in
 * the moment before its insert. Nothing was written. `ClockService.latePress`
 * asks every rule again; after three tries the pad holds the press and sends
 * it later.
 */
export class ClockRowCollided extends ConflictException {
  constructor() {
    super({
      message: 'Another clock press was saved at the same moment. Send this one again.',
      code: CLOCK_ROW_COLLIDED,
    });
  }
}

/**
 * Take a press, and ask EVERY rule again when its row collided: the row that
 * won may have ended the clock, opened the round or ended the bout. A new
 * sequence alone would write a press nobody judged. Three tries.
 */
export async function againOnCollision<T>(take: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await take();
    } catch (refusal) {
      if (!(refusal instanceof ClockRowCollided) || attempt === 3) throw refusal;
    }
  }
}

/** The codes of the two refusals below. The pad holds the press and says them. */
export const BOUT_COMPLETED = 'bout_completed';
export const CLOCK_PRESS_OUT_OF_ORDER = 'clock_press_out_of_order';

/**
 * A late Start, Halt or Resume does not put a completed bout back in play: that
 * can wipe the bouts fought after it, and nobody is looking. A person re-opens
 * a bout.
 */
export const boutCompleted = () =>
  new ConflictException({
    message: 'This bout is completed. A clock press sent late does not re-open it.',
    code: BOUT_COMPLETED,
  });

export const CLOCK_PRESS_TOO_OLD = 'clock_press_too_old';

/**
 * The oldest press the server applies: one day (operator, 2026-10-10). Also
 * the oldest age it reads off a hit or a card (`scoredAtServer`).
 */
export const OLDEST_PRESS_MS = 24 * 60 * 60 * 1000;

/**
 * A press made more than a day before its send is not applied: a tablet left
 * in a bag must not move the clock of a bout still open a week later. No new
 * send cures it. The pad itself blocks nothing by age (ruling 10).
 */
export const pressTooOld = () =>
  new ConflictException({
    message: 'This clock press was made more than a day ago. It is not applied.',
    code: CLOCK_PRESS_TOO_OLD,
  });

/** A press that fits nothing the clock can do from where it is (ruling 12). */
export const pressOutOfOrder = (action: PressAction, status: ClockState['status']) =>
  new ConflictException({
    message: `Cannot ${action} clock when status is '${status}'`,
    code: CLOCK_PRESS_OUT_OF_ORDER,
  });

/** Does the server hold this press? A failed read is an error, never a "no". */
export async function pressIsSaved(supabase: Database, clientUuid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('match_events')
    .select('id')
    .eq('client_uuid', clientUuid)
    .maybeSingle();
  if (error) throw new Error(`Could not read a clock press: ${error.message}`);
  return data !== null;
}

/** The time of the row the bout's timeline ends with, or null for an empty one. */
async function lastRowAt(supabase: Database, matchId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('match_events')
    .select('occurred_at')
    .eq('match_id', matchId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the timeline of bout ${matchId}: ${error.message}`);
  return (data as { occurred_at: string } | null)?.occurred_at ?? null;
}

/** `placedAt` for a row of this bout: `atMs`, or the time of the bout's last row when that is later. */
export async function placedInTimeline(
  supabase: Database,
  matchId: string,
  atMs: number,
): Promise<string> {
  return placedAt(atMs, await lastRowAt(supabase, matchId));
}

/** A press that is new to the server and not already true, as the clock's door read it. */
export interface AskedPress {
  matchId: string;
  /** The bout's row, with the columns the clock reads. */
  match: Record<string, unknown>;
  action: PressAction;
  press: LatePress;
  mayPassLock: boolean;
  /** Can the clock do this from where it is? The clock's own table says. */
  fits: boolean;
  clockStatus: ClockState['status'];
}

/**
 * Does the bout take this press, and where does it go in the timeline? The
 * answer is the time of its row. Each refusal leaves the bout untouched.
 *
 *   - A completed bout is never put back in play. An End stays: it stops the
 *     clock of a bout a forfeit completed, and decides nothing again.
 *   - A press older than one day is not applied.
 *   - A press from before the bout's last reset is for the fight that was
 *     cancelled. Read on the server's time of the press, not the pad's.
 *   - The rules of every press: the lock, what the clock can do from where it
 *     is, a round that waits for "Start round N+1".
 */
export async function placeLatePress(supabase: Database, asked: AskedPress): Promise<string> {
  const { matchId, match, action } = asked;
  if (match['status'] === 'completed' && action !== 'end') throw boutCompleted();

  const nowMs = Date.now();
  const pressedMs = pressedAtServer(asked.press, nowMs);
  if (nowMs - pressedMs > OLDEST_PRESS_MS) throw pressTooOld();
  await assertScoredAfterLastReset(supabase, matchId, new Date(pressedMs).toISOString());
  if (match['locked_at'] && !asked.mayPassLock) throw matchLocked();
  if (!asked.fits) throw pressOutOfOrder(action, asked.clockStatus);
  if ((action === 'start' || action === 'resume') && match['awaiting_round_advance']) {
    throw roundAwaitsAdvance();
  }
  return placedInTimeline(supabase, matchId, pressedMs);
}
