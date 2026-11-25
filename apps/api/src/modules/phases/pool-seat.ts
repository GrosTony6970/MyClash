import type { PoolSeat } from '@myclash/types/pool-standings';
import { eventHemaRatingsId, type RatedPerson } from '../hema-ratings/event-hema-ratings-id';
import { sideLabel, type RegistrationEmbed, type TeamEmbed } from '../matches/side-label';

/**
 * A Registration as the Pools page reads it: its Person's name, club and HEMA Ratings ids
 * (`persons(given_name, family_name, clubs(name), hema_ratings_id, global_persons(hema_ratings_id))`).
 */
export type PoolSeatRegistration = RegistrationEmbed<{ name: string | null }> & {
  persons: (RegistrationEmbed<{ name: string | null }>['persons'] & RatedPerson) | null;
};

/**
 * The entrant of a Pool seat, or of a Registration or team waiting for a seat. Throws for a seat
 * that names neither: the seat's one-entrant check (0282) forbids one, and the Pools page seats and
 * unseats by this key, so a seat without one would be an entrant nobody could move.
 */
export function poolSeatOf(
  registration: PoolSeatRegistration | null,
  team: TeamEmbed | null,
  weightedRatings: ReadonlyMap<string, number>,
): PoolSeat {
  const label = sideLabel(registration, team);
  if (label.id === null) throw new Error('A Pool seat names no entrant');
  const hemaRatingsId = eventHemaRatingsId(registration?.persons);
  return {
    sideId: label.id,
    kind: label.kind,
    registrationId: registration?.id ?? null,
    name: label.name,
    personName: label.kind === 'individual' ? label.name : null,
    clubLabel: label.club?.name ?? null,
    colour: label.colour,
    logoUrl: label.logoUrl,
    hemaWeightedRating: hemaRatingsId ? (weightedRatings.get(hemaRatingsId) ?? null) : null,
  };
}
