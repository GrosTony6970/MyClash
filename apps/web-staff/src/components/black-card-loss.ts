import { sideKey } from '@myclash/types/side-key';
import type { MatchPenalty } from '../hooks/usePenalties';

/**
 * The name of the side whose black card ended the match, or null: the black-card banner names
 * it. A match can complete with an earlier (non-forfeiting) black card on record, so we gate on
 * `endReason === 'black_card'` — only then is the black card the cause — and take the first
 * non-voided black card's side (the one who forfeited).
 *
 * The card's side is its side key: a Fighter's Registration, or a team (call 5: a black card on
 * a team names the team). A side still to come is null, and null is nobody, never that side.
 */
export function blackCardLoserName(args: {
  endReason: string | null | undefined;
  penalties: MatchPenalty[];
  redSideId: string | null;
  blueSideId: string | null;
  redName: string;
  blueName: string;
}): string | null {
  if (args.endReason !== 'black_card') return null;
  const card = args.penalties.find((p) => p.card === 'black' && !p.voided);
  const loser = card ? sideKey(card.registration_id, card.team_id) : null;
  if (loser === null) return null;
  if (loser === args.redSideId) return args.redName;
  if (loser === args.blueSideId) return args.blueName;
  return null;
}
