/**
 * Can a new send save this held hit? Not one scored before its bout's last
 * reset (ruling 290): the server refuses it every time. So its row in the
 * inbox offers Discard alone, and Retry on the bar leaves it held (ruling 291).
 */
export function canSendAgain(held: { rejectedReason: string; rejectedCode?: string }): boolean {
  return held.rejectedCode !== 'scored_before_reset';
}
