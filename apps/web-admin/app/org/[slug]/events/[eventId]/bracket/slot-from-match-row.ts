import type { BracketSlotData } from '@myclash/ui';

/** The `matches` columns a realtime change carries that a bracket card shows. */
export interface IncomingMatchRow {
  id: string;
  bracket_slot_id?: string | null;
  red_score?: number | null;
  blue_score?: number | null;
  status?: string;
  red_registration_id?: string | null;
  blue_registration_id?: string | null;
  winner_registration_id?: string | null;
}

/**
 * A bracket card after a realtime change to its bout, merged in place.
 *
 * The card crowns the stored winner only (spec 2026-11-27-bout-result-is-stored): a bout that
 * finishes names it here, a reopened one clears it. Left out, a finished bout read winner-less —
 * no crown, an empty podium step — until the next poll; the score fallback used to hide that.
 */
export function slotFromMatchRow(
  slot: BracketSlotData,
  incoming: IncomingMatchRow,
): BracketSlotData {
  return {
    ...slot,
    matchId: incoming.id,
    redScore: incoming.red_score ?? slot.redScore,
    blueScore: incoming.blue_score ?? slot.blueScore,
    status: incoming.status ?? slot.status,
    winnerRegistrationId:
      incoming.winner_registration_id !== undefined
        ? incoming.winner_registration_id
        : slot.winnerRegistrationId,
  };
}
