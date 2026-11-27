import { BadRequestException } from '@nestjs/common';
import { idOf, sidesOf } from './bout-sides';

/**
 * The side a request names: a Registration (a Fighter) or a team (ADR-022). A forfeit, a card and
 * a protest each name one, and each door asks the same two things of it here: which side the body
 * names, and whether that side is a side of this bout.
 */

/** A side a request names: its kind, and its key (`sideKey`), the Registration id or the team id. */
export interface NamedSide {
  kind: 'registration' | 'team';
  id: string;
}

/**
 * The side a body names, from exactly one of its two fields. The DTO refuses both and neither;
 * this refuses them again for a caller that builds no DTO (the team black card's forfeit). The
 * noun is the entry that asks, for the refusal's words.
 */
export function namedSideOf(
  fields: { registrationId?: string; teamId?: string },
  noun: 'forfeit' | 'card' | 'protest',
): NamedSide {
  const { registrationId, teamId } = fields;
  if (teamId && !registrationId) return { kind: 'team', id: teamId };
  if (registrationId && !teamId) return { kind: 'registration', id: registrationId };
  throw new BadRequestException(`A ${noun} names exactly one side: a Registration or a team`);
}

/** The bout's two side keys, and which of them are teams. */
export interface BoutSideKinds {
  redSideId: string | null;
  blueSideId: string | null;
  redTeamId: string | null;
  blueTeamId: string | null;
}

/** A bout row's side keys (`sidesOf`) and its teams, as `isSideOfBout` judges them. */
export function sideKindsOf(row: Record<string, unknown>): BoutSideKinds {
  const sides = sidesOf(row);
  return {
    redSideId: sides.red,
    blueSideId: sides.blue,
    redTeamId: idOf(row['red_team_id']),
    blueTeamId: idOf(row['blue_team_id']),
  };
}

/**
 * Whether `side` is a side of the bout: by its key, and of its kind, so a team id sent as a
 * Registration is refused here rather than by the database. A side still null on the bout is
 * refused too: no key equals null.
 */
export function isSideOfBout(bout: BoutSideKinds, side: NamedSide): boolean {
  if (side.id !== bout.redSideId && side.id !== bout.blueSideId) return false;
  const isTeam = side.id === bout.redTeamId || side.id === bout.blueTeamId;
  return isTeam === (side.kind === 'team');
}
