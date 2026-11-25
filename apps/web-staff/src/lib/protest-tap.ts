/**
 * The tap of a protest button, out of the hook (`useProtestTap`): web-staff has
 * no React test setup.
 *
 * A tap records the protest on the tablet first, then asks for a send nobody
 * waits for (ruling 316), then moves the bout's sequence on: offline, the
 * protest is in the queue before any network call. No question is asked.
 *
 * The round written is the round open on the pad; between rounds and after the
 * end, the round that just ended (the server stamps its own).
 */
import type { MatchInfo } from '../components/MatchView';
import { elapsedActiveMs, type ClockState } from '../components/scoreboard-clock';
import type { BoutNames } from '../offline/db';
import { queueProtest } from '../offline/protest-queue';
import type { SyncEngine } from '../offline/sync';

export interface ProtestTapArgs {
  match: Pick<MatchInfo, 'id' | 'redRegistrationId' | 'blueRegistrationId'>;
  nextSequence: number;
  submit: { bout: BoutNames; round: number };
  /** The clock's time NOW, called at the tap (`clockAtTap`): the button is live while it runs. */
  clockTimeMs: () => number | null;
  syncEngine?: SyncEngine | null;
  onRecorded: () => void;
  /** A tap of a corner with no Fighter yet: the screen says why nothing was written. */
  onNoFighter: () => void;
}

/**
 * The match clock's time at this moment, or null with no clock. Not the
 * clock's `activeMs`: while the clock runs, that is the time banked at its
 * last start, and the part since then is in `runningFrom` (`elapsedActiveMs`).
 * A hit or a card is entered on a stopped clock only; a protest is not.
 */
export function clockAtTap(state: ClockState | null, now = Date.now()): number | null {
  return state ? elapsedActiveMs(state, now) : null;
}

/**
 * The tap of one corner. It answers the `clientUuid` of the protest it wrote,
 * or null when it ignored the tap, and rejects when the tablet could not keep
 * the protest.
 *
 * The races, with one tap for both corners of the pad:
 *
 *  - A double tap. Two taps of one corner before the screen draws again read
 *    the same `nextSequence`, and both would be written, so one tap of a finger
 *    would record two protests. `inFlight` holds the corners being written: a
 *    tap of a corner while its protest is out is ignored, and opens no card offer.
 *  - Two Fighters protest at once. A tap of the OTHER corner while a protest is
 *    being written is never dropped: it is written too, with its own number.
 *  - A tap after a write, before the screen draws again, reads the old
 *    `nextSequence`. A second tap of one corner after the first was written
 *    records a second protest.
 *
 * Two writes never share a number, whatever `nextSequence` the tap read: the
 * store writes one entry at a time and gives each at least the bout's next
 * number (`enqueue`, `Math.max(entry.sequence, await nextSequence(...))`).
 */
export function protestTap(
  args: ProtestTapArgs,
  inFlight: Set<'red' | 'blue'>,
): (corner: 'red' | 'blue') => Promise<string | null> {
  const { match, nextSequence, submit, clockTimeMs, syncEngine, onRecorded } = args;
  return async (corner) => {
    const registrationId = corner === 'red' ? match.redRegistrationId : match.blueRegistrationId;
    // A corner with no Fighter yet (a bracket slot to fill) has nobody to protest for: the
    // screen says so, and nothing is written.
    if (registrationId === null) {
      args.onNoFighter();
      return null;
    }
    if (inFlight.has(corner)) return null;
    inFlight.add(corner);
    let written: string;
    try {
      written = await queueProtest({
        matchId: match.id,
        sequence: nextSequence,
        side: { kind: 'registration', id: registrationId },
        clockTimeMs: clockTimeMs(),
        round: submit.round,
        bout: submit.bout,
        cardedColor: corner,
      });
    } finally {
      inFlight.delete(corner);
    }
    syncEngine?.sendBehind();
    onRecorded();
    return written;
  };
}
