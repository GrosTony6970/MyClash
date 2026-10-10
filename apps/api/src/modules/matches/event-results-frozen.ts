import { ConflictException } from '@nestjs/common';

/** The code of the refusal below. The pad and web-admin say it in the reader's language. */
export const EVENT_RESULTS_FROZEN = 'event_results_frozen';

/**
 * The ONE refusal of a write that changes a result once the Event is over: a
 * new hit, a new card, a result override and a clock press sent late all throw
 * it. The object form: a bare string put this English sentence in front of a
 * French referee. A pad holds what it sent and says the code.
 */
export const eventResultsFrozen = () =>
  new ConflictException({ message: 'Event results are frozen', code: EVENT_RESULTS_FROZEN });
