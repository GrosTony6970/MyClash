import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The organiser books a person they name (operator ruling 535): one of this Event's people only.
 * A booking's person is an Event's roster row, and nothing ties it to the session's Event (no
 * foreign key reaches it): an organiser of one Event could book a person of another club's Event,
 * whose name the roster would then show. Asked before any write.
 *
 * A read that failed is an error, never "not on this Event": the organiser would be told a person
 * on the Persons page is not there.
 */
export async function assertPersonOnEvent(
  db: SupabaseClient,
  eventId: string | null | undefined,
  personId: string,
): Promise<void> {
  if (!eventId) throw new Error(`The Event of the session booked for ${personId} was not read`);
  const { data, error } = await db
    .from('persons')
    .select('id')
    .eq('id', personId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error)
    throw new Error(`Person ${personId} of event ${eventId} was not read: ${error.message}`);
  if (!data) {
    throw new NotFoundException({
      error: 'PersonNotInEvent',
      message: 'This person is not on this event.',
    });
  }
}
