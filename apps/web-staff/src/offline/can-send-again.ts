/**
 * Can a new send save this held hit? Not one scored before its bout's last
 * reset (ruling 290): the server refuses it every time. Not a clock press made
 * more than a day before its send either (operator, 2026-10-10): it only gets
 * older. Not an End the server judged pressed before the bout's time, or on a
 * level bout: the server judges the End at the time it was pressed, which no
 * new send moves. Not a clock press or a round press made before the bout was
 * last put back in play (operator, 2026-10-11): its time does not move either.
 * So its row in the inbox offers Discard alone, and Retry on the bar leaves it
 * held (ruling 291).
 */
const NEVER_AGAIN = new Set([
  'scored_before_reset',
  'clock_press_too_old',
  'time_not_finished',
  'level_at_time_unresolved',
  'pressed_before_reopen',
]);

export function canSendAgain(held: { rejectedReason: string; rejectedCode?: string }): boolean {
  return !NEVER_AGAIN.has(held.rejectedCode ?? '');
}
