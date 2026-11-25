import { BadRequestException } from '@nestjs/common';
import type { BlackCardEffect } from '@myclash/rulesets';
import type { ForfeitingSide } from '../matches/forfeit-side';

/**
 * The side a card names: a Registration (a Fighter) or a team (ADR-022, call 5). A team takes a
 * card as a whole, and what it does stops at its Match: a team black card loses this Match only
 * (ruling 972), and a team's card count starts fresh every Match (ruling 976). A team has no
 * status, so none of the Fighter part of a black card runs for it: no Tournament count, no
 * "second black card" review, no status settle.
 */

type Row = Record<string, unknown>;

/** A card's side: the kind and the key (`sideKey`), as a forfeit's. */
export type CardSide = ForfeitingSide;

/**
 * The side a card names, from exactly one of its two fields. The DTO refuses both and neither;
 * this refuses them again for a caller that builds no DTO.
 */
export function cardSideOf(input: { registrationId?: string; teamId?: string }): CardSide {
  const { registrationId, teamId } = input;
  if (teamId && !registrationId) return { kind: 'team', id: teamId };
  if (registrationId && !teamId) return { kind: 'registration', id: registrationId };
  throw new BadRequestException('A card names exactly one side: a Registration or a team');
}

/**
 * The side a saved card names, by the column of its kind. The database holds one of the two on
 * every card (0282): a row with neither was read without them, an error, never "no side".
 */
export function savedCardSide(card: Row): CardSide {
  const teamId = card['team_id'];
  if (typeof teamId === 'string') return { kind: 'team', id: teamId };
  const registrationId = card['registration_id'];
  if (typeof registrationId === 'string') return { kind: 'registration', id: registrationId };
  throw new Error(`Card ${String(card['id'])} names no side`);
}

/** The bout's two side keys, and which of them are teams. */
export interface CardBout {
  redSideId: string | null;
  blueSideId: string | null;
  redTeamId: string | null;
  blueTeamId: string | null;
}

/**
 * Whether `side` is a side of the bout: by its key, and of its kind, so a team id sent as a
 * Registration is refused here rather than by the database.
 */
export function isCardSideOfBout(bout: CardBout, side: CardSide): boolean {
  if (side.id !== bout.redSideId && side.id !== bout.blueSideId) return false;
  const isTeam = side.id === bout.redTeamId || side.id === bout.blueTeamId;
  return isTeam === (side.kind === 'team');
}

/** The bout's known sides, each of its kind; a side not known yet is left out. */
export function boutCardSides(bout: CardBout): CardSide[] {
  const teams = [bout.redTeamId, bout.blueTeamId];
  return [bout.redSideId, bout.blueSideId].flatMap((id): CardSide[] =>
    id === null ? [] : [{ kind: teams.includes(id) ? 'team' : 'registration', id }],
  );
}

/** The column a card of this side is stored in, and read back by (0282). */
export const cardSideColumn = (side: CardSide): 'registration_id' | 'team_id' =>
  side.kind === 'team' ? 'team_id' : 'registration_id';

/** Both side columns of a new card: the side's key in the column of its kind, null in the other. */
export const cardSideColumns = (side: CardSide) => ({
  registration_id: side.kind === 'registration' ? side.id : null,
  team_id: side.kind === 'team' ? side.id : null,
});

/**
 * Where the card ladder counts a side's earlier offences. A Fighter's: where the penalty list's
 * `accumulation_scope` says. A team's: this Match only, whatever the list says (ruling 976).
 */
export const ladderScopeOf = (listScope: string, side: CardSide): string =>
  side.kind === 'team' ? 'match' : listScope;

/**
 * What a team black card does (ruling 972): the team forfeits this Match, as a 1st black card,
 * whatever the forfeit rules say a black card reaches. Its forfeit runs on a bout not completed
 * only (call 2), as a Fighter's does.
 */
export function teamBlackCardForfeit(
  teamId: string,
  note: string,
): {
  dto: { forfeitingTeamId: string; reason: 'black_card_1'; note: string };
  cardEffect: BlackCardEffect;
} {
  return { dto: { forfeitingTeamId: teamId, reason: 'black_card_1', note }, cardEffect: 'match' };
}
