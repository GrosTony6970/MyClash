/**
 * Is this bout over, for a screen that shows it? The ONE rule: the scoreboard
 * asks it before it counts down to the next bout, and the piste TV asks it
 * before it keeps a bout its piste no longer names.
 *
 * Both words are needed. A bout a correction reopened is `paused` again while
 * its clock still reads `ended`: it is not over, and the screen stays on it.
 */
export function boutIsOver(
  status: string | null | undefined,
  clockStatus: string | null | undefined,
): boolean {
  return clockStatus === 'ended' && status === 'completed';
}
