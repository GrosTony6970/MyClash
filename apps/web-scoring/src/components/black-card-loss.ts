import type { MatchPenalty } from '../hooks/usePenalties';

/**
 * The registration id of the fighter whose black card ended the match, or
 * null. A match can complete with an earlier (non-forfeiting) black card on
 * record, so we gate on `endReason === 'black_card'` — only then is the
 * black card the cause — and return the first non-voided black-card penalty's
 * fighter (the one who forfeited).
 */
export function blackCardLossRegistrationId(
  endReason: string | null | undefined,
  penalties: MatchPenalty[],
): string | null {
  if (endReason !== 'black_card') return null;
  return penalties.find((p) => p.card === 'black' && !p.voided)?.registration_id ?? null;
}
