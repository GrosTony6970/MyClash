/**
 * Is the protest button live? Longer than card entry: a Fighter protests a
 * call while the clock is paused, between rounds and after the end. Off on a
 * bout not started, on a locked bout, and on an Event that is over (its
 * results are frozen). The server follows the same rule.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
export function protestButtonLive(args: {
  boutStatus: string;
  lockedAt: string | null;
  eventOver: boolean;
}): boolean {
  const { boutStatus, lockedAt, eventOver } = args;
  const played = boutStatus === 'running' || boutStatus === 'paused' || boutStatus === 'completed';
  return played && !lockedAt && !eventOver;
}
