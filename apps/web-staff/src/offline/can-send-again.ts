/**
 * Can a new send save this held hit? Not one scored before its bout's last
 * reset (ruling 290): the server refuses it every time. Not a clock press made
 * more than a day before its send either (operator, 2026-10-10): it only gets
 * older. Not an End the server judged pressed before the bout's time, or on a
 * level bout: the server judges the End at the time it was pressed, which no
 * new send moves. Not a clock press or a round press made before the bout was
 * last put back in play (operator, 2026-10-11): its time does not move either.
 * Not a step of a level bout the server judged on a board that was not level,
 * or at another place of the chain than the tablet counted: the entries the
 * step was tapped on are on the server by then, and a new send finds the same.
 * So its row in the inbox offers Discard alone, and Retry on the bar leaves it
 * held (ruling 291).
 */
const NEVER_AGAIN = new Set([
  'scored_before_reset',
  'clock_press_too_old',
  'time_not_finished',
  'level_at_time_unresolved',
  'pressed_before_reopen',
  'bout_not_level',
  'level_step_not_pending',
]);

/**
 * Of a step of a level bout only. A completed bout takes the step again only
 * after a Reopen, and the step is then from before the bout was put back in
 * play. A round that waits for its next one, or a bout in another round: the
 * round the step was tapped in is over. A clock press and a round press keep
 * their Retry on these codes: another device can cure them.
 */
const NEVER_AGAIN_FOR_A_STEP = new Set([
  'bout_completed',
  'round_awaits_advance',
  'round_not_open',
]);

export function canSendAgain(held: {
  rejectedReason: string;
  rejectedCode?: string;
  kind?: string;
}): boolean {
  const code = held.rejectedCode ?? '';
  if (held.kind === 'level' && NEVER_AGAIN_FOR_A_STEP.has(code)) return false;
  return !NEVER_AGAIN.has(code);
}
