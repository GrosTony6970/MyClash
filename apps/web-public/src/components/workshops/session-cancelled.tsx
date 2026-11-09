// A Workshop session the organiser cancelled (operator rulings 526-529). It stays on every page,
// struck through and marked "Cancelled", so people who saw it know it is off. It is never booked,
// never "live", no time clash, and a place in it holds nothing.
//
// No 'use client': the home page renders it on the server as the Workshop pages do in the browser.
// The caller hands its own translator, so this file reads no message tree.

import { StatusBadge, statusLabel, workshopStatusSemantic } from '@myclash/ui';

/** True for a cancelled session: the one test, shared with the organiser's board. */
export { isCancelledSession } from '@myclash/schedule-core';

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

/** A cancelled session's line on a card: its time struck through, then the badge. */
export function CancelledSessionLine({
  when,
  t,
  className = '',
}: {
  when: string | null;
  t: (key: string) => string;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-2 text-xs ${className}`}>
      {when && <span className={CANCELLED_TEXT}>{when}</span>}
      <CancelledBadge t={t} />
    </p>
  );
}
