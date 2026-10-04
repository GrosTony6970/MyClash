'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { LegalNotice } from '../../../../../src/components/LegalConsent';

const CARD = 'mb-6 rounded-xl border border-dashed border-border bg-surface px-4 py-3';

interface ThisIsMeCardProps {
  eventSlug: string;
  personId: string;
  /** An account holds this roster name: it is not a guest's to pick, nor anybody's to claim. */
  hasAccount: boolean;
  /** Only a visitor with no guest session is offered the quick access. */
  offerGuestAccess: boolean;
  guestLoading: boolean;
  onGuestAccess: () => void;
}

/**
 * A name an account holds (operator ruling 269): the server shuts both doors
 * there, so the card offers neither. It says so, and the holder signs in.
 */
function HeldNameCard() {
  const { t } = useI18n();
  return (
    <div className={CARD}>
      <p className="text-sm text-foreground-secondary">{t('publicApp.people.guestHasAccount')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/login"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground"
        >
          {t('publicApp.home.signIn')}
        </Link>
      </div>
    </div>
  );
}

/**
 * "This is me" on a participant's page: the doors into the event-scoped claim
 * flow and the guest session. Shown to a visitor with no account; a signed-in
 * one sees nothing.
 */
export function ThisIsMeCard({
  eventSlug,
  personId,
  hasAccount,
  offerGuestAccess,
  guestLoading,
  onGuestAccess,
}: ThisIsMeCardProps) {
  const { t } = useI18n();
  if (hasAccount) return <HeldNameCard />;

  return (
    <div className={CARD}>
      <p className="text-sm text-foreground-secondary">
        <span className="font-semibold text-foreground">{t('publicApp.people.thisIsMeTitle')}</span>{' '}
        {t('publicApp.people.thisIsMeHint')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/e/${eventSlug}/claim?personId=${personId}&next=${encodeURIComponent(`/e/${eventSlug}`)}`}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {t('publicApp.people.claimButton')}
        </Link>
        {offerGuestAccess && (
          <button
            type="button"
            onClick={onGuestAccess}
            disabled={guestLoading}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-muted disabled:opacity-50"
          >
            {t('publicApp.people.guestAccessButton')}
          </button>
        )}
      </div>
      {/* Notice, not a gate: continuing as a guest hands over no new
          personal data — the roster row is already the organiser's — so a
          competitor looking up their own pool is informed, not blocked. */}
      <LegalNotice className="mt-3" />
    </div>
  );
}
