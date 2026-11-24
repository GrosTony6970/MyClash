import { sideKey } from '@myclash/types/side-key';

/** A Registration as a screen's read embeds it: its id, and its Person with the club. */
export interface RegistrationEmbed<Club> {
  id: string;
  persons: {
    given_name: string | null;
    family_name: string | null;
    clubs?: Club | null;
  } | null;
}

/** A team as a screen's read embeds it (`teams`, 0281 and 0283). */
export interface TeamEmbed {
  id: string;
  name: string;
  color: string | null;
  logo_url: string | null;
}

/** What a screen prints for one side of a Match, a Pool seat or a standings row. */
export interface SideLabel<Club> {
  kind: 'individual' | 'team';
  /** The side key (`sideKey`): the Registration id or the team id; null when neither is read. */
  id: string | null;
  name: string;
  /** The Fighter's club. A team has no club (decision 13 of the design). */
  club: Club | null;
  /** One of the colour names of `TOURNAMENT_COLORS`, or none. A Fighter has no colour. */
  colour: string | null;
  logoUrl: string | null;
}

/**
 * The one owner of "what a side is called" (ADR-022, the side resolver of the design).
 *
 * A side is a Registration or a team, never both: `sideKey` throws on both. A team gives its own
 * name, colour and logo, and no club. A Registration gives its Person's name and club, and no
 * colour or logo. A Registration whose Person is not read gives an empty name, as the readers
 * before this one did.
 */
export function sideLabel<Club>(
  registration: RegistrationEmbed<Club> | null,
  team: TeamEmbed | null,
): SideLabel<Club> {
  const id = sideKey(registration?.id, team?.id);
  if (team) {
    return {
      kind: 'team',
      id,
      name: team.name,
      club: null,
      colour: team.color,
      logoUrl: team.logo_url,
    };
  }
  const person = registration?.persons ?? null;
  return {
    kind: 'individual',
    id,
    name: `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim(),
    club: person?.clubs ?? null,
    colour: null,
    logoUrl: null,
  };
}
