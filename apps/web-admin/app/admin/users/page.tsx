'use client';

import { useEffect, useState } from 'react';
import { AdminPageHeader, Button, SegmentedTabs } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { AccountsPanel } from './AccountsPanel';
import { CreatePlatformAccountForm } from './CreatePlatformAccountForm';
import { isUsersTab, type UsersTab } from './types';

/**
 * Platform accounts, split by who the account IS.
 *
 * One flat list mixed the operator's own platform staff, every organiser, and
 * every fighter who ever signed in — three populations with nothing in common
 * but a row in auth.users. The tabs are the API's scopes, and like them they
 * are predicates rather than a partition: an account that both holds a
 * platform role and belongs to an organisation appears under Platform AND
 * Organisers. That is the normal shape for a HEMA organiser who also works the
 * platform, and a partition would have to file them somewhere wrong.
 */
export default function AdminUsersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<UsersTab>('platform');
  const [createdKey, setCreatedKey] = useState(0);

  // Deep-link `?tab=` without next/navigation's useSearchParams — that hook
  // makes the React Compiler bail out of the component, which costs the
  // memoization the panels rely on. Read once on mount, write back on change.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time deep-link read on mount
    if (isUsersTab(q)) setTab(q);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [tab]);

  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-6 px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.dashboard.eyebrow')}
        title={t('admin.users.title')}
        subtitle={t('admin.users.description')}
        actions={
          // Remounts the panel, which re-runs its fetch. Bumping the key rather
          // than threading a ref down keeps the panel's paging state private.
          <Button variant="back" onClick={() => setCreatedKey((key) => key + 1)}>
            {t('admin.users.refresh')}
          </Button>
        }
      />

      <SegmentedTabs
        tabs={[
          { value: 'platform' as const, label: t('admin.users.tabs.platform') },
          { value: 'organizer' as const, label: t('admin.users.tabs.organiser') },
          { value: 'user' as const, label: t('admin.users.tabs.user') },
        ]}
        value={tab}
        onChange={setTab}
        aria-label={t('admin.users.tabsLabel')}
        className="max-w-xl"
      />

      {/*
        Creating an account belongs to the Platform tab: a new account has no
        organisation, so it lands here and nowhere else.
      */}
      {tab === 'platform' && (
        <CreatePlatformAccountForm onCreated={() => setCreatedKey((key) => key + 1)} />
      )}

      {/* `key` remounts the panel on a tab switch, so page and search reset
          with it — carrying page 4 of Organisers into Users would show an
          empty table and read as "no accounts". */}
      <AccountsPanel key={`${tab}-${createdKey}`} tab={tab} />
    </main>
  );
}
