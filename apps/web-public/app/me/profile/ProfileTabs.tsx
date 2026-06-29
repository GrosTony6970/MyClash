'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SegmentedTabs } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { FighterProfileClient } from '../../profile/fighter/FighterProfileClient';
import { RefereeProfileClient } from '../../profile/referee/RefereeProfileClient';

type ProfileTab = 'fighter' | 'referee';

/**
 * Unified profile surface: a sticky Fighter | Referee segmented switch over the
 * two restyled deep-dives. The active tab lives in the URL (`?tab=referee`) so
 * it's deep-linkable and back-button friendly; the bottom-nav / sidebar
 * "Profile" entry and the /me/fighter + /me/referee redirects all land here.
 */
export function ProfileTabs({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: ProfileTab = searchParams.get('tab') === 'referee' ? 'referee' : 'fighter';

  const setTab = (next: ProfileTab) => {
    router.replace(next === 'referee' ? '/me/profile?tab=referee' : '/me/profile', {
      scroll: false,
    });
  };

  const header =
    tab === 'referee'
      ? {
          title: t('publicApp.fighterProfile.refereeDashboard'),
          description: t('publicApp.fighterProfile.refereeDashboardDescription'),
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
            ]}
          />
        </div>

        {tab === 'referee' ? (
          <RefereeProfileClient apiUrl={apiUrl} />
        ) : (
          <FighterProfileClient apiUrl={apiUrl} />
        )}
      </div>
    </main>
  );
}
