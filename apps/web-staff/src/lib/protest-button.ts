/**
 * Is the protest button live? Longer than card entry: a Fighter protests a
 * call while the clock is paused, between rounds and after the end. Off on a
 * bout not started, on a locked bout, and on an Event that is over (its
 * results are frozen).
 *
 * The server's rule is wider, as it is for a card: it refuses a protest on a
 * bout not started (`assertBoutTakes` refuses only `scheduled`), on a locked
 * bout and on an Event that is over, but it takes one on a voided bout. The
 * button is the narrower rule.
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
