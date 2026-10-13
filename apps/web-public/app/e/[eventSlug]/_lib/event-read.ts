import type { EventInfo } from '../_components/EventHeader';

/**
 * What the read of an Event said. Three things, never two: "this Event does
 * not exist" and "the read failed" are different pages. One `null` for both
 * turned an outage into a missing Event, and a missing Event into a near-blank
 * page (quick win F13).
 */
export type EventRead =
  { kind: 'found'; event: EventInfo } | { kind: 'notFound' } | { kind: 'failed' };

/**
 * What a read that gave no Event says, by its HTTP status (`null`: it never
 * landed). Only a 404 says the Event is not there: the API answers one for an
 * unknown address, and for a draft or test Event to anybody outside its club.
 * Any other refusal, and a dead network, is a failure.
 */
export function eventReadFailure(status: number | null): Exclude<EventRead, { kind: 'found' }> {
  return status === 404 ? { kind: 'notFound' } : { kind: 'failed' };
}
