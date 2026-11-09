// A Workshop session the organiser cancelled (operator rulings 526-529). It stays on every page,
// struck through and marked "Cancelled", so people who saw it know it is off. It is never booked,
// never "live", no time clash, and a place in it holds nothing.
//
// No 'use client': the home page renders it on the server as the Workshop pages do in the browser.
// The caller hands its own translator, so this file reads no message tree.

import { StatusBadge, statusLabel, workshopStatusSemantic } from '@myclash/ui';

/** True for a cancelled session. A status that is absent (an older copy) is not cancelled. */
export function isCancelledSession(session: { status?: string | null }): boolean {
  return session.status === 'cancelled';
}

/** The look of a cancelled session's time and place. */
export const CANCELLED_TEXT = 'line-through text-muted';

/** The "Cancelled" badge beside a cancelled session. */
export function CancelledBadge({ t }: { t: (key: string) => string }) {
  return (
    <StatusBadge semantic={workshopStatusSemantic('cancelled')} surface="light">
      {statusLabel('workshopSession', 'cancelled', t)}
    </StatusBadge>
  );
}
