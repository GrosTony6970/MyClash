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
 * The race is a double tap: two taps before the screen draws again read the
 * same `nextSequence`, and both would be written (the store gives the second
 * the next number), so one tap of a finger records two protests. `inFlight`
 * holds the tap being written: a tap while it is out is ignored, and opens no
 * card offer. A second tap after the first was written records a second protest.
 */
export function protestTap(
  args: ProtestTapArgs,
  inFlight: { current: boolean },
): (corner: 'red' | 'blue') => Promise<string | null> {
  const { match, nextSequence, submit, clockTimeMs, syncEngine, onRecorded } = args;
  return async (corner) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    let written: string;
    try {
      written = await queueProtest({
        matchId: match.id,
        sequence: nextSequence,
        registrationId: corner === 'red' ? match.redRegistrationId : match.blueRegistrationId,
        clockTimeMs: clockTimeMs(),
        round: submit.round,
        bout: submit.bout,
        cardedColor: corner,
      });
    } finally {
      inFlight.current = false;
    }
    syncEngine?.sendBehind();
    onRecorded();
    return written;
  };
}
