import { SetMetadata } from '@nestjs/common';

export const BLOCK_ON_COMPLETED_EVENT_KEY = 'block-on-completed-event';

/**
 * Refuse this route once the event is `completed`, not just `archived`.
 *
 * A completed event is finished but not yet put away, and tidying the record is
 * legitimate work: re-time a bout, swap a referee, fix a name. So the default
 * stays open, and only the routes that DESTROY the plan carry this — regenerate
 * pools, delete a bracket, wipe the programme, bulk-clear a crew. Nobody
 * regenerates the pools of an event that has already been fought.
 *
 * Applied across phases, programme AND referees together. Marking one module
 * would be worse than marking none: it teaches an operator the other two are
 * protected when they are not.
 *
 * Interacts with the `discardScoredResults` override on generate-pools. On a
 * completed event this guard refuses first, so the override never gets a look
 * in and the owner sees "this event is completed" rather than the scored-bout
 * message. That precedence is deliberate — a completed event outranks a
 * per-request override — but it surprises people, hence this note.
 *
 * A marked route whose event cannot be resolved FAILS CLOSED. See the guard.
 */
export const BlockOnCompletedEvent = () => SetMetadata(BLOCK_ON_COMPLETED_EVENT_KEY, true);
