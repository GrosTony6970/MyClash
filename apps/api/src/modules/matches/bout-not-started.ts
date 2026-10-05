import { ConflictException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { assertScoredAfterLastReset } from './hit-before-reset';

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
 */
function assertBoutStarted(status: unknown): void {
  if (status !== 'scheduled') return;
  throw new ConflictException({
    message: 'This bout is not started, or it was reset. It takes a hit or a card once it runs.',
    code: BOUT_NOT_STARTED,
  });
}

/** A new hit or card, as its door read it. */
export interface NewScore {
  /** The pad's time of the hit or the card. */
  occurredAt: string;
  /** A card the referee gives by hand, from the corrections drawer. */
  directCard?: unknown;
}

/**
 * Does this bout take this new hit or card? The one question both create doors
 * ask, AFTER their replay probe: a hit the server holds is answered with its
 * saved row.
 *
 *   - scored before the bout's last reset: never (ruling 290);
 *   - for a bout nobody started: no (ruling 286), but a DIRECT card is taken
 *     there, for a Fighter who is late on the piste (ruling 286a).
 *
 * The reset first: a bout still `scheduled` after its reset says the truer
 * reason, the one a new send cannot cure.
 */
export async function assertBoutTakes(
  supabase: SupabaseService['service'],
  bout: { id: string; status: unknown },
  scored: NewScore,
): Promise<void> {
  await assertScoredAfterLastReset(supabase, bout.id, scored.occurredAt);
  if (scored.directCard === undefined) assertBoutStarted(bout.status);
}
