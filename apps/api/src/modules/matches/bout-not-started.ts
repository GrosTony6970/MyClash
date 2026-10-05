import { ConflictException } from '@nestjs/common';

/** The code of the refusal below. The pad says it in the reader's language. */
export const BOUT_NOT_STARTED = 'bout_not_started';

/**
 * A new hit or card is for a bout somebody started (ruling 286).
 *
 * A pad starts a bout online and may score it offline. So a queued hit that
 * meets a `scheduled` bout was scored before the bout was put back: by a reset,
 * by the undo of an earlier bracket bout, or of a forfeit. Taken, it gave an
 * unplayed bout a score, and the next fight began from it.
 *
 * Only `scheduled` is refused. A hit on a completed bout is a correction, with
 * its own rules, and a row read with no status is not judged here. A 409 with a
 * code, so the pad holds the hit: the scorer sends it again or discards it.
 * Asked AFTER the replay probe of each door: a hit the server holds is answered
 * with its saved row.
 */
export function assertBoutStarted(status: unknown): void {
  if (status !== 'scheduled') return;
  throw new ConflictException({
    message: 'This bout is not started, or it was reset. It takes a hit or a card once it runs.',
    code: BOUT_NOT_STARTED,
  });
}
