/**
 * A roster person as the rating readers embed it:
 * `persons(hema_ratings_id, global_persons(hema_ratings_id))`. `persons` holds
 * `global_person_id`, a plain many-to-one FK, so the profile embeds as an
 * object.
 */
export interface RatedPerson {
  hema_ratings_id?: string | null;
  global_persons?: { hema_ratings_id?: string | null } | null;
}

/**
 * The HEMA Ratings id an Event uses for one of its people: the roster row's
 * own, else the one on the global profile the row is linked to. Trimmed; blank
 * counts as absent on either row.
 *
 * The roster row comes first (operator rulings 39 and 42, 2026-09-22). It is
 * what the organiser typed for THIS Event, and since ruling 35 nothing copies
 * it onto the shared profile, so a profile that had no id keeps none. Every
 * reader of an Event fighter's rating or id goes through here — seeding, the
 * Pools pages, the readiness check, the public participants list, the HEMA
 * Ratings export — because the ids the ratings lookup is asked for and the
 * ids each caller then looks up must be the same. The nightly sync fetches the
 * ratings of roster ids too (ruling 41), or a roster-only id would have no
 * rating to look up.
 */
export function eventHemaRatingsId(person: RatedPerson | null | undefined): string | null {
  return person?.hema_ratings_id?.trim() || person?.global_persons?.hema_ratings_id?.trim() || null;
}
