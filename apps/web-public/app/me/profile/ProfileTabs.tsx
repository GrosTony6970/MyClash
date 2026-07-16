'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SegmentedTabs } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { FighterProfileClient } from '../../profile/fighter/FighterProfileClient';
import { RefereeProfileClient } from '../../profile/referee/RefereeProfileClient';
import { WorkshopProfileClient } from './WorkshopProfileClient';

type ProfileTab = 'fighter' | 'referee' | 'workshop';

const parseTab = (raw: string | null): ProfileTab =>
  raw === 'referee' ? 'referee' : raw === 'workshop' ? 'workshop' : 'fighter';

/**
 * Unified profile surface: a sticky Fighter | Referee | Workshop segmented switch
 * over the restyled deep-dives. The active tab lives in the URL (`?tab=referee`,
 * `?tab=workshop`) so it's deep-linkable and back-button friendly; the bottom-nav
 * / sidebar "Profile" entry and the /me/fighter + /me/referee redirects all land
 * here.
 */
export function ProfileTabs() {
  // Resolve the API base URL on the client (browser value). Receiving a
  // server-resolved `getPublicApiUrl()` prop would leak the docker-internal
  // `http://api:4000` host into the page and get blocked as mixed content on
  // HTTPS — the same pattern used by SettingsClient/InstructorDashboard.
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: ProfileTab = parseTab(searchParams.get('tab'));

  const setTab = (next: ProfileTab) => {
    router.replace(next === 'fighter' ? '/me/profile' : `/me/profile?tab=${next}`, {
      scroll: false,
    });
  };

  const header =
    tab === 'referee'
      ? {
          title: t('publicApp.fighterProfile.refereeDashboard'),
          description: t('publicApp.fighterProfile.refereeDashboardDescription'),
        }
      : tab === 'workshop'
        ? {
            title: t('publicApp.fighterProfile.workshopDashboard'),
            description: t('publicApp.fighterProfile.workshopDashboardDescription'),
          }
        : {
            title: t('publicApp.fighterProfile.profileDashboard'),
            description: t('publicApp.fighterProfile.profileDashboardDescription'),
          };

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {header.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{header.description}</p>
        </header>

        <div className="mb-4">
          <SegmentedTabs<ProfileTab>
            aria-label={t('publicApp.me.profile.tabsLabel')}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'fighter', label: t('publicApp.personalShell.nav.fighter') },
              { value: 'referee', label: t('publicApp.personalShell.nav.referee') },
              { value: 'workshop', label: t('publicApp.personalShell.nav.workshop') },
            ]}
          />
        </div>

        {tab === 'referee' ? (
          <RefereeProfileClient apiUrl={apiUrl} />
        ) : tab === 'workshop' ? (
          <WorkshopProfileClient apiUrl={apiUrl} />
        ) : (
          <FighterProfileClient apiUrl={apiUrl} />
        )}
      </div>
    </main>
  );
}
