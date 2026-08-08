'use client';

import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { StaffLoginLink } from './StaffLoginLink';

interface Props {
  /** Resolved event slug. The panel is not rendered before it is known. */
  eventSlug: string;
  staffUrl: string;
  publicAppUrl: string;
}

/**
 * The two event-level URLs, shared by all three roles.
 *
 * The staff app is ONE door: the same sign-in link serves a piste scorer, a
 * check-in volunteer and a gear checker, and the role on their account decides
 * where they land. That is why this sits above the tabs rather than inside one.
 */
export function StaffLoginPanel({ eventSlug, staffUrl, publicAppUrl }: Props) {
  const { t } = useI18n();

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-display font-semibold text-lg">{t('organizer.staff.staffLogin')}</h2>
      <div className="mt-2 space-y-2">
        <StaffLoginLink
          label={t('organizer.staff.staffLoginUrl')}
          description={t('organizer.staff.staffLoginHelp')}
          url={`${staffUrl}/login?event=${encodeURIComponent(eventSlug)}`}
          withQr
        />
        <StaffLoginLink
          label={t('organizer.staff.displayHubUrl')}
          url={`${publicAppUrl}/e/${eventSlug}/display`}
        />
      </div>
    </section>
  );
}
