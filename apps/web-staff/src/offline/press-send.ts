/**
 * How a queued clock press goes to the server, and the order of a bout's rows
 * in one send (operator rulings 11 to 14 of the quick-win list, and the two of
 * 2026-10-10).
 *
 * The door is `POST /matches/:id/clock` with the press's id and its two times
 * (`ClockService.latePress` on the server). The server takes each press once,
 * and answers a press that is already true as done.
 */
import { fetchRenewingLogin } from '@myclash/api-client';
import { kindOf, type OutboxEntry } from './db';
import { pressTimes, tabletTime, type TabletTime } from './press-age';

/** The server's word for "another press was saved in the same moment": send it again later. */
export const CLOCK_ROW_COLLIDED = 'clock_row_collided';

export function postPress(
  apiUrl: string,
  entry: OutboxEntry,
  now: TabletTime = tabletTime(),
): Promise<Response> {
  return fetchRenewingLogin(apiUrl, `/api/v1/matches/${entry.matchId}/clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      action: entry.pressAction,
      clientUuid: entry.clientUuid,
      ...pressTimes(entry, now),
    }),
  });
}

/**
 * The send time a queued hit or card carries beside its own time
 * (`occurredAt`): that time plus its age. The server reads the age and nothing
 * else. When the hit or the card decides the bout, the server stops the clock
 * by itself, that long ago and not at the time the queue arrives.
 */
export function sentAtOf(entry: OutboxEntry, now: TabletTime = tabletTime()): string {
  return pressTimes(entry, now).sentAt;
}

/** Why a row is not sent in this pass, when it must wait for a row before it. */
export type Waits =
  /** A press of its bout is held in the inbox. Nothing is tried, nothing is counted. */
  | 'behind-held'
  /** A row of its bout before it was not sent in this pass: it meets that row's end. */
  | 'failed'
  | 'offline';

/**
 * The order of each bout's rows within one pass of the queue.
 *
 * The server judges a press against the bout as it is when the press arrives.
 * A hit is refused on a bout nobody started, and an End names the winner from
 * the hits the server holds. So:
 *
 *   - While a press of a bout is HELD (the server refused it), every row of
 *     that bout waits. A Retry or a Discard of the press, in the inbox, frees
 *     them (operator, 2026-10-10). Other bouts go on.
 *   - A press that could not be sent (no network, a server fault) stops the
 *     rows of its bout behind it for this pass.
 *   - A press never passes a hit or a card of its bout that could not be sent.
 *
 * A hit behind a hit that could not be sent still goes, as before: two hits
 * do not depend on each other.
 */
export class BoutOrder {
  private readonly unsent = new Map<string, { press: boolean; outcome: 'failed' | 'offline' }>();

  /** `held`: the bouts that hold a refused press when the pass starts. */
  constructor(private readonly held: Set<string>) {}

  waits(entry: OutboxEntry): Waits | null {
    if (this.held.has(entry.matchId)) return 'behind-held';
    const before = this.unsent.get(entry.matchId);
    if (!before) return null;
    return before.press || kindOf(entry) === 'press' ? before.outcome : null;
  }

  /** What became of a row this pass sent. */
  note(entry: OutboxEntry, outcome: 'sent' | 'held' | 'failed' | 'offline'): void {
    const press = kindOf(entry) === 'press';
    if (outcome === 'held' && press) this.held.add(entry.matchId);
    if (outcome !== 'failed' && outcome !== 'offline') return;
    const before = this.unsent.get(entry.matchId);
    this.unsent.set(entry.matchId, { press: press || before?.press === true, outcome });
  }
}
