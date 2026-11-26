import { sideKey } from '@myclash/types/side-key';
import type { BracketSideWire, BracketSlotWire } from '@myclash/types/bracket-side';
import { sideLabel, type RegistrationEmbed, type TeamEmbed } from './side-label';

/**
 * The team of each side of a `bracket_slots` read, beside its `registration_a_id` /
 * `registration_b_id`. A side is one or the other (0282), so a read of a slot's sides asks for both
 * kinds.
 */
export const SLOT_TEAM_EMBEDS =
  'team_a:teams!bracket_slots_team_a_id_fkey(id,name,color,logo_url),' +
  'team_b:teams!bracket_slots_team_b_id_fkey(id,name,color,logo_url)';

/** A slot row read with its Registration columns and `SLOT_TEAM_EMBEDS`. */
export interface SlotSides {
  registration_a_id: string | null;
  registration_b_id: string | null;
  team_a?: TeamEmbed | null;
  team_b?: TeamEmbed | null;
}

/** The side keys of a slot (`sideKey`): what a seeding plan or a ranking compares. */
export function slotSideKeys(slot: SlotSides): { a: string | null; b: string | null } {
  return {
    a: sideKey(slot.registration_a_id, slot.team_a?.id),
    b: sideKey(slot.registration_b_id, slot.team_b?.id),
  };
}

/** The recorded winner of a bout, by its two columns (`winnerColumns`). */
export interface WinnerOfBout {
  winner_registration_id: string | null;
  winner_team_id: string | null;
}

/** The fields of a bracket slot that name its sides and its winner. */
export type BracketSlotSideFields = Pick<
  BracketSlotWire,
  | 'redFighterName'
  | 'blueFighterName'
  | 'redClubAbbrev'
  | 'blueClubAbbrev'
  | 'redSideId'
  | 'blueSideId'
  | 'winnerSideId'
  | 'red'
  | 'blue'
>;

/**
 * The sides of a bracket slot, as both bracket reads send them. A side is named by `sideLabel` (the
 * one owner of what a side is called): a team by its name and colour, a Fighter by the Person of
 * its Registration, read apart (`registrations`). `clubAbbrev` is each read's own way to print a
 * club. A side not filled yet is null, and its name is null.
 */
export function bracketSlotSides<Club>(
  slot: SlotSides,
  bout: WinnerOfBout | null,
  registrations: ReadonlyMap<string, RegistrationEmbed<Club>>,
  clubAbbrev: (club: Club | null) => string | null,
): BracketSlotSideFields {
  // Each side is keyed once (`slotSideKeys`); the typed side and the top-level key share it.
  const { a: redSideId, b: blueSideId } = slotSideKeys(slot);
  const side = (
    sideId: string | null,
    registrationId: string | null,
    team: TeamEmbed | null,
  ): BracketSideWire | null => {
    if (!sideId) return null;
    const registration = registrationId
      ? (registrations.get(registrationId) ?? { id: registrationId, persons: null })
      : null;
    const label = sideLabel(registration, team);
    return {
      sideId,
      kind: label.kind,
      registrationId,
      teamId: team?.id ?? null,
      // A name not known is null, never '': '' would silence every fallback downstream.
      name: label.name || null,
      clubAbbrev: clubAbbrev(label.club),
      colour: label.colour,
    };
  };
  const red = side(redSideId, slot.registration_a_id, slot.team_a ?? null);
  const blue = side(blueSideId, slot.registration_b_id, slot.team_b ?? null);
  return {
    redFighterName: red?.name ?? null,
    blueFighterName: blue?.name ?? null,
    redClubAbbrev: red?.clubAbbrev ?? null,
    blueClubAbbrev: blue?.clubAbbrev ?? null,
    redSideId,
    blueSideId,
    winnerSideId: sideKey(bout?.winner_registration_id, bout?.winner_team_id),
    red,
    blue,
  };
}
