import { IDLE_POLL_MS, deriveFreshness, type Freshness } from '@myclash/ui';

/** The board reads itself this often whatever its channel says: an Event that
 *  hides a bout from the public never announces it on the channel. */
export const BOARD_POLL_MS = IDLE_POLL_MS;

export interface BoardFreshnessInput {
  /** `disable_realtime`, from the public flags. */
  realtimeDisabled: boolean;
  /** The channel's last word, or null: no channel yet, or it has said nothing so far. */
  channelStatus: string | null;
  /** When a read last landed, or null before the first one. */
  lastUpdateAt: number | null;
  now: number;
}

/**
 * Does the board depend on its poll alone? Only when its channel SAID it is
 * down, or the operator switched realtime off. A channel that has said nothing
 * yet is still joining: calling that "slower updates" flashed the word on every
 * page load, and a story could pass on a channel that had not failed at all.
 */
export function boardIsDegraded({
  realtimeDisabled,
  channelStatus,
}: Pick<BoardFreshnessInput, 'realtimeDisabled' | 'channelStatus'>): boolean {
  return realtimeDisabled || (channelStatus !== null && channelStatus !== 'SUBSCRIBED');
}

/** How fresh the live board is: the shared rule, told the poll only while it is all there is. */
export function boardFreshness(input: BoardFreshnessInput): Freshness {
  return deriveFreshness({
    ...input,
    pollMs: boardIsDegraded(input) ? BOARD_POLL_MS : undefined,
  });
}
