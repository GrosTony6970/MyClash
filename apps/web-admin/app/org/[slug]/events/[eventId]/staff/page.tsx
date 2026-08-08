'use client';

import { useParams } from 'next/navigation';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { getStaffUrl } from '@/lib/staff-url';
import { BackLink } from '@/components/BackLink';
import { StaffLoginPanel } from './StaffLoginPanel';
import { StaffRoleSection } from './StaffRoleSection';
import { useStaffAccounts } from './useStaffAccounts';

/**
 * Event staff, split by the job each account does.
 *
 * One flat list was right while every staff account was a scoring account.
 * Migration 0173 made the role a real gate, so the page splits along it: an
 * organiser configuring the check-in desk should not be scrolling past twelve
 * piste accounts to find two, and — more importantly — the create form on each
 * tab sets the role implicitly, so the choice cannot be made wrong under time
 * pressure on an event morning.
 *
 * The tabs partition, they do not overlap: `role` is a single NOT NULL column,
 * so the three counts sum to the total.
 */
export default function EventStaffPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t } = useI18n();

  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';
  const staffUrl = getStaffUrl();
  const staff = useStaffAccounts(eventId);

  // Every URL on this page — staff login, display hub, per-Lice display —
  // resolves the event by SLUG on the server. The id is not a substitute, so
  // there is nothing to show until the event has loaded.
  const eventSlug = staff.event?.slug ?? null;

  return (
    <main className="mx-auto max-w-[110rem] p-8">
      <BackLink href={`/org/${slug}/events/${eventId}`} label={t('organizer.staff.backToEvent')} />
      <h1 className="mt-3 font-display font-bold text-2xl sm:text-3xl">
        {t('organizer.staff.title')}
      </h1>
      <p className="mt-1 text-sm text-muted">{t('organizer.staff.description')}</p>

      {eventSlug && (
        <StaffLoginPanel eventSlug={eventSlug} staffUrl={staffUrl} publicAppUrl={publicAppUrl} />
      )}

      <StaffRoleSection
        staff={staff}
        staffUrl={staffUrl}
        publicAppUrl={publicAppUrl}
        eventSlug={eventSlug}
      />
    </main>
  );
}
