'use client';

import { useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import { useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { canTick, checkInRefusal } from './roster-check-in';
import { rosterRequests } from './roster-requests';

/**
 * The "Present" box of one roster row (operator rulings 539-545). Ticked or cleared by the server;
 * the row is then patched from its answer, not re-read: a re-read swaps the whole list for
 * "Loading…", which at the door would flash once per name and drop the focus. A later full read
 * replaces the patch with the server's state.
 *
 * No box for a refused person (541). A cancelled session's box shows its state and takes no tap
 * (526); an archived Event takes none either.
 */
interface CheckInTarget {
  apiUrl: string;
  sessionId: string;
  booking: { id: string; personId: string; status: string; checkedInAt?: string | null };
  onSaved: (bookingId: string, checkedInAt: string | null) => void;
}

export function RosterCheckIn({
  name,
  readOnly,
  cancelled,
  ...target
}: CheckInTarget & { name: string; readOnly: boolean; cancelled: boolean }) {
  const { t } = useI18n();
  const { busy, tick } = useTick(target);
  if (!canTick(target.booking.status)) return null;

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-secondary">
      <input
        type="checkbox"
        aria-label={t('organizer.workshopsPage.presentFor', { name })}
        checked={Boolean(target.booking.checkedInAt)}
        disabled={readOnly || cancelled || busy}
        onChange={(e) => void tick(e.target.checked)}
        className="h-4 w-4 rounded accent-success disabled:opacity-50"
      />
      {t('organizer.workshopsPage.present')}
    </label>
  );
}

/** The tap's request: the row patched from the answer, a refusal said in the reader's words. */
function useTick({ apiUrl, sessionId, booking, onSaved }: CheckInTarget) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function tick(present: boolean) {
    setBusy(true);
    try {
      const { path, method } = rosterRequests(sessionId, booking).checkIn;
      const r = await apiRequest<{ checkedInAt: string | null }>(apiUrl, path, {
        method,
        body: { present },
      });
      if (r.ok) onSaved(booking.id, r.data.checkedInAt);
      else {
        const message = checkInRefusal(r, t);
        if (message) toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return { busy, tick };
}
