import { eventHemaRatingsId, type RatedPerson } from '../hema-ratings/event-hema-ratings-id';
import { sideLabel, type RegistrationEmbed, type TeamEmbed } from '../matches/side-label';

/**
 * A Registration as the Pools page reads it: its Person's name, club and HEMA Ratings ids
 * (`persons(given_name, family_name, clubs(name), hema_ratings_id, global_persons(hema_ratings_id))`).
 */
export type PoolSeatRegistration = RegistrationEmbed<{ name: string | null }> & {
  persons: (RegistrationEmbed<{ name: string | null }>['persons'] & RatedPerson) | null;
};

/** One entrant as the Pools page lists it, in a Pool or waiting for one. */
export interface PoolSeat {
  /** The side key (`sideKey`): the Registration id or the team id. Never null: a seat names one. */
  sideId: string;
  kind: 'individual' | 'team';
  /** The Registration of an individual entrant; null for a team, never a team id. */
  registrationId: string | null;
  name: string;
  /** The Fighter's name; null for a team, which is not a person. */
  personName: string | null;
  clubLabel: string | null;
  colour: string | null;
  logoUrl: string | null;
  /** A Fighter's weighted HEMA rating; null for a team, which has no rating (decision 13). */
  hemaWeightedRating: number | null;
}

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
