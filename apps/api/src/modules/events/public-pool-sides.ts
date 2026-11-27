import { sideKey } from '@myclash/types/side-key';
import { boutSideLabels, sideName, type BoutSideEmbeds } from '../matches/bout-side-labels';
import type { RegistrationEmbed, SideLabel, TeamEmbed } from '../matches/side-label';
import { poolSeatOf } from '../phases/pool-seat';

/** A Fighter's club as the public Pool reads embed it. */
export interface PublicClub {
  name: string | null;
  abbreviation: string | null;
}

/** A Pool bout row of the public Pool read: its two sides of both kinds, and its winner. */
export interface PublicPoolBoutRow extends BoutSideEmbeds<PublicClub> {
  winner_registration_id: string | null;
  winner_team_id: string | null;
}

/** The club pill of a side: the abbreviation, else the full name. A team has no club. */
function clubAbbrev(label: SideLabel<PublicClub>): string | null {
  return label.club?.abbreviation ?? label.club?.name ?? null;
}

/**
 * The two sides of a public Pool bout, each named through `sideLabel` (a team by its team, with
 * its colour and logo, call 6), and each side's key beside its Registration id. The public Pool
 * page marks the reader's own bouts by `redRegistrationId` / `blueRegistrationId`, so those stay;
 * a team side has none and sends null there.
 */
export function publicPoolBoutSides(row: PublicPoolBoutRow) {
  const { red, blue } = boutSideLabels(row);
  return {
    redFighterName: sideName(red),
    redClubAbbrev: clubAbbrev(red),
    redRegistrationId: row.red?.id ?? null,
    redSideId: sideKey(row.red?.id, row.red_team?.id),
    redColour: red.colour,
    redLogoUrl: red.logoUrl,
    blueFighterName: sideName(blue),
    blueClubAbbrev: clubAbbrev(blue),
    blueRegistrationId: row.blue?.id ?? null,
    blueSideId: sideKey(row.blue?.id, row.blue_team?.id),
    blueColour: blue.colour,
    blueLogoUrl: blue.logoUrl,
    /** Authoritative over the scores: a forfeit or an override can win on the lower score. */
    winnerRegistrationId: row.winner_registration_id,
    winnerSideId: sideKey(row.winner_registration_id, row.winner_team_id),
  };
}

/** A Pool seat as the public Pool composition reads it: a Registration or a team (0282). */
export interface PublicPoolMemberRow {
  registration_id: string | null;
  seed: number | null;
  registrations: RegistrationEmbed<PublicClub> | null;
  teams: TeamEmbed | null;
}

/** The public page shows no rating, so the seat is read with none. */
const NO_RATINGS: ReadonlyMap<string, number> = new Map();

/**
 * One member of a public Pool, through `poolSeatOf` (the one owner of a Pool seat): a team by its
 * name, colour and logo, a Fighter by name and club. `registrationId` stays for the reader's own
 * mark, null for a team. A seat with no name reads '—', as the page has always shown.
 */
export function publicPoolMember(member: PublicPoolMemberRow) {
  const seat = poolSeatOf(member.registrations, member.teams, NO_RATINGS);
  return {
    registrationId: member.registration_id,
    sideId: seat.sideId,
    kind: seat.kind,
    fighterName: seat.name || '—',
    clubName: seat.clubLabel,
    clubAbbreviation: member.registrations?.persons?.clubs?.abbreviation ?? null,
    colour: seat.colour,
    logoUrl: seat.logoUrl,
    seed: member.seed ?? null,
  };
}
