import { NotFoundException } from '@nestjs/common';
import { readableEvent, type CompetitionEvent, type PublicReader } from './competition-visibility';
import type { EventAuthzDeps } from './event-authz';
import { eventNotFound } from './event-read-gate';
import { hiddenEntrantIds } from './hidden-entrants';

/**
 * The public bar onto one Event's person (rulings 121a, 130, 129, 167) — the one owner for the
 * person page's header, its schedule, a follow and the guest sign-in ("This is me"). The Event
 * must be one the caller may see (a draft or test Event only for its club and active staff) and
 * the person must be in THAT Event, and not entered only in Tournaments hidden from the caller.
 * A hidden Event answers exactly as an unknown Event; a person of another Event, or entered only
 * in a draft, exactly as an unknown person. All of it comes before anything about the person is
 * answered or written.
 *
 * `personColumns` is what the caller reads of the person; `id` must be among them.
 */
export async function readEventPerson<Person extends { id: string }>(
  deps: EventAuthzDeps,
  eventId: string,
  personId: string,
  reader: PublicReader,
  personColumns: string,
): Promise<{ event: CompetitionEvent; person: Person }> {
  const event = await readableEvent(deps, eventId, reader);
  if (!event) throw eventNotFound(eventId);

  const { data: person, error: personError } = await deps.supabase.service
    .from('persons')
    .select(personColumns)
    .eq('id', personId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (personError) throw new Error(`person read failed: ${personError.message}`);
  if (!person || (await hiddenEntrantIds(deps, event, reader)).has(personId)) {
    throw new NotFoundException(`Person "${personId}" not found`);
  }
  return { event, person: person as unknown as Person };
}
