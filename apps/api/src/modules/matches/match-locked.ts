import { BadRequestException } from '@nestjs/common';

/** The code of the refusal below. The pad says it in the reader's language. */
export const MATCH_LOCKED = 'match_locked';

/**
 * The ONE refusal of a write to a locked bout by a caller who may not pass
 * the lock: a hit, a card, the clock, a forfeit and its undo all throw it.
 * A 400 with its own code and the words it always had: the pad's queue holds
 * a 400 after one more send, and keeps the code with the hit.
 */
export const matchLocked = () =>
  new BadRequestException({ message: 'Match is locked', code: MATCH_LOCKED });
