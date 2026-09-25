import { NotFoundException } from '@nestjs/common';
import type { CompetitionEvent, PublicReader } from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import { assertCanReadEventRow, eventNotFound } from '../../common/auth/event-read-gate';

/**
 * The public bar onto one Event's person (rulings 121a, 130) — the person schedule's
 * (`PublicScheduleService.getPublicSchedule`). The Event must be one the caller may see (a draft
 * or test Event only for its club) and the person must be in THAT Event. A hidden Event answers
 * exactly as an unknown Event; a person of another Event exactly as an unknown person. Both checks
 * come before anything about the person is read. Shared by the public person page and a follow;
 * `getPublicSchedule` still holds the same bar in its own code.
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
  const { data: event, error: eventError } = await deps.supabase.service
    .from('events')
    .select('id, status, organization_id, event_kind')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw new Error(`event read failed: ${eventError.message}`);
  if (!event) throw eventNotFound(eventId);
  await assertCanReadEventRow(deps, eventId, event as CompetitionEvent, () =>
    Promise.resolve(reader.userId),
  );

  const { data: person, error: personError } = await deps.supabase.service
    .from('persons')
    .select(personColumns)
    .eq('id', personId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (personError) throw new Error(`person read failed: ${personError.message}`);
  if (!person) throw new NotFoundException(`Person "${personId}" not found`);
  return { event: event as CompetitionEvent, person: person as unknown as Person };
}
