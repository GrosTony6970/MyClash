'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatInZone } from '@myclash/time';
import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { UnknownCaller } from '@/components/me/workshop-booking';

const NOTICE = 'rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm';
const DOOR =
  'rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-muted';

/**
 * What a caller the booking door did not know reads, under the sessions, until a
 * tap is accepted (operator ruling 266). A visitor has two ways in: her name on
 * the participants list (a guest session, or a claim), or her account. An
 * account that is signed in and not on this Event's roster is told so: "sign in"
 * would send it round in a circle.
 */
export function UnknownCallerNotice({
  who,
  eventSlug,
}: {
  who: UnknownCaller;
  eventSlug: string;
}): ReactNode {
  const { t } = useI18n();
  if (who === 'account') {
    return (
      <p role="status" className={`${NOTICE} text-foreground-secondary`}>
        {t('publicApp.workshopDetail.accountNotOnRoster')}
      </p>
    );
  }
  return (
    <div role="status" className={`${NOTICE} text-foreground-secondary`}>
      <p>{t('publicApp.workshopDetail.findYourName')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/e/${eventSlug}/participants`} className={DOOR}>
          {t('publicApp.workshopDetail.participantsList')}
        </Link>
        <Link href="/login" className={DOOR}>
          {t('publicApp.home.signIn')}
        </Link>
      </div>
    </div>
  );
}

/**
 * The read of the caller's bookings failed (operator ruling 271): every session
 * shows "Register", a seat she holds included. The buttons stay usable: the
 * server answers a second booking with the seat she has.
 */
export function BookingsUnread({ onRetry }: { onRetry: () => void }): ReactNode {
  const { t } = useI18n();
  return (
    <div role="alert" className={`${NOTICE} flex flex-wrap items-center justify-between gap-3`}>
      <p className="font-medium text-warning">{t('publicApp.workshopDetail.bookingsUnread')}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('actions.retry')}
      </Button>
    </div>
  );
}

/**
 * A guest is told nothing of a seat that comes to her from the waitlist, of a
 * cancelled session or of a start: an alert goes to an account (operator ruling
 * 267). The page says so, with the way to an account: the claim of her name.
 */
export function GuestAlertsLine({
  eventSlug,
  personId,
}: {
  eventSlug: string;
  personId: string;
}): ReactNode {
  const { t } = useI18n();
  const back = encodeURIComponent(`/e/${eventSlug}`);
  return (
    <p className="text-sm text-foreground-secondary">
      {t('publicApp.workshopDetail.guestNoAlerts')}{' '}
      <Link
        href={`/e/${eventSlug}/claim?personId=${personId}&next=${back}`}
        className="font-semibold underline hover:no-underline"
      >
        {t('publicApp.people.claimButton')}
      </Link>
    </p>
  );
}

/** A session's day, hours and place, and how full it is. */
export function SessionWhen({
  session,
  timezone,
  bcp47,
  enrolled,
}: {
  session: { startsAt: string | null; endsAt: string | null; locationLabel: string | null };
  timezone: string;
  bcp47: string;
  /** "12/20 enrolled", or null when the Workshop has no limit. */
  enrolled: string | null;
}): ReactNode {
  const hour = (iso: string) =>
    formatInZone(iso, timezone, { hour: '2-digit', minute: '2-digit' }, bcp47);
  return (
    <div>
      {session.startsAt && (
        <p className="font-medium text-foreground">
          {formatInZone(
            session.startsAt,
            timezone,
            { weekday: 'short', day: 'numeric', month: 'short' },
            bcp47,
          )}
        </p>
      )}
      {(session.startsAt || session.endsAt || session.locationLabel) && (
        <p className="text-sm text-muted">
          {session.startsAt && hour(session.startsAt)}
          {session.startsAt && session.endsAt && ' – '}
          {session.endsAt && hour(session.endsAt)}
          {session.locationLabel && ` · ${session.locationLabel}`}
        </p>
      )}
      {enrolled && <p className="text-xs text-muted mt-0.5">{enrolled}</p>}
    </div>
  );
}
