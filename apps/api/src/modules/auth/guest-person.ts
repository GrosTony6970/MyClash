import type { MePersonDto } from './dto/me-response.dto';

/**
 * A guest's roster person as `/me` hands it, from the row `/me` read.
 *
 * Without its holder: who holds a name is not a guest's to read, and `/me` only
 * asks so it can answer "nobody" on a name an account holds (ruling 265). With
 * her Event's address, where the site header sends her: her schedule (ruling
 * 268). `person` is undefined when the read gave no row.
 */
export function guestPersonOf(row: unknown): {
  holder: string | null;
  person: MePersonDto | undefined;
} {
  if (!row) return { holder: null, person: undefined };
  const {
    claimed_by_user_id: holder,
    events,
    ...person
  } = row as MePersonDto & { claimed_by_user_id?: string | null; events?: unknown };
  // PostgREST embeds a to-one parent as an object; the typed client says array.
  const event = (Array.isArray(events) ? events[0] : events) as { slug?: string } | null;
  return {
    holder: holder ?? null,
    person: event?.slug ? { ...person, event_slug: event.slug } : person,
  };
}
