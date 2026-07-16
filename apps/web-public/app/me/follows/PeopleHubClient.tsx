'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, SegmentedTabs } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import FollowsClient from './FollowsClient';
import { GroupsTab } from './GroupsTab';
import { SearchTab } from './SearchTab';
import { useDirectoryGroups } from './useDirectoryGroups';

type PeopleTab = 'following' | 'search' | 'groups';

/**
 * `/me/follows` — the "People" hub. Three tabs over a shared groups store:
 *  • Following — the existing event-scoped follow list (notifications)
 *  • Search    — fuzzy-search the global directory; Follow / Add to group
 *  • My groups — your collections, member cards with stats
 * The active tab lives in the URL (`?tab=`) for deep-linking + back-button.
 */
export function PeopleHubClient() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const router = useRouter();
  const params = useSearchParams();
  const groupsApi = useDirectoryGroups(apiUrl);

  const raw = params.get('tab');
  const tab: PeopleTab = raw === 'search' || raw === 'groups' ? raw : 'following';

  const setTab = (next: PeopleTab) =>
    router.replace(next === 'following' ? '/me/follows' : `/me/follows?tab=${next}`, {
      scroll: false,
    });

  const needsAuth = groupsApi.status === 'unauthorized';

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.me.people.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.me.people.subtitle')}</p>
        </header>

        <SegmentedTabs<PeopleTab>
          aria-label={t('publicApp.me.people.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'following', label: t('publicApp.me.people.tabFollowing') },
            { value: 'search', label: t('publicApp.me.people.tabSearch') },
            { value: 'groups', label: t('publicApp.me.people.tabGroups') },
          ]}
        />

        {tab === 'following' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{t('publicApp.me.people.followingSubtitle')}</p>
            <FollowsClient embedded />
          </div>
        )}

        {tab === 'search' &&
          (needsAuth ? (
            <EmptyState title={t('publicApp.me.people.signInToManage')} />
          ) : (
            <SearchTab apiUrl={apiUrl} groupsApi={groupsApi} />
          ))}

        {tab === 'groups' &&
          (needsAuth ? (
            <EmptyState title={t('publicApp.me.people.signInToManage')} />
          ) : (
            <GroupsTab apiUrl={apiUrl} groupsApi={groupsApi} />
          ))}
      </div>
    </main>
  );
}
