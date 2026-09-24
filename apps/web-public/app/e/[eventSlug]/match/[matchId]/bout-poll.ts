import { fallbackPollMs } from '@myclash/ui';
import type { MatchRow } from './match-row';

export interface BoutPollInput {
  /** The bout was finished when the page loaded: no channel, no poll. */
  isFinal: boolean;
  /** The kill-switch is on or the channel dropped: nothing is pushed. */
  degraded: boolean;
  /** The bout as last read or pushed. */
  match: Pick<MatchRow, 'status' | 'hiddenFromPublic'>;
  /** `document.visibilityState === 'visible'`. */
  visible: boolean;
  /** The channel's last reported status. */
  channelStatus: string | null;
}

export interface BoutPoll {
  /** The refetch interval, or null for no poll at all. */
  pollMs: number | null;
  /** The channel status the freshness chip is given. */
  channelStatus: string | null;
}

const FINAL_STATUSES = new Set(['completed', 'voided']);

/**
 * When the spectator bout page refetches, and what its freshness chip is told.
 *
 * - The channel is degraded: nothing is pushed, so the page polls at its
 *   fallback cadence (`fallbackPollMs`).
 * - The bout is hidden from the public (ruling 92): web-public's channel is
 *   anonymous and RLS keeps the bout's rows off it, so a SUBSCRIBED channel
 *   never announces a touch — a club member's page froze on its first picture.
 *   It polls at the same cadence until a read shows the bout finished. The
 *   poll, not the channel, carries the page, so the chip is not given the
 *   channel's SUBSCRIBED: it says `polling`, as it does for a dropped channel.
 */
export function boutPoll(input: BoutPollInput): BoutPoll {
  const { isFinal, degraded, match, visible, channelStatus } = input;
  const hidden = match.hiddenFromPublic && !FINAL_STATUSES.has(match.status);
  if (isFinal || !(degraded || hidden)) return { pollMs: null, channelStatus };
  const pollMs = fallbackPollMs({ status: match.status, visible });
  return { pollMs, channelStatus: degraded ? channelStatus : null };
}
