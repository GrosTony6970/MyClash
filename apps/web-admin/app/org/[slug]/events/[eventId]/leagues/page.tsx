'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { t } from '@myclash/i18n';
import { RequestsTab } from './_components/RequestsTab';
import { MembershipsTab } from './_components/MembershipsTab';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

type TabKey = 'requests' | 'memberships';

function isTabKey(value: string | null): value is TabKey {
  return value === 'requests' || value === 'memberships';
}

export default function EventLeagueAttachmentPage() {
  const params = useParams<{ eventId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(isTabKey(queryTab) ? queryTab : 'requests');

  // Keep `?tab=` in sync so the operator can deep-link a tab from outside.
  useEffect(() => {
    if (queryTab === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [tab, queryTab, router]);

  const tabClass = (key: TabKey) =>
    [
      'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px',
      tab === key
        ? 'bg-surface border border-b-surface border-border text-foreground'
        : 'text-muted hover:text-foreground-secondary',
    ].join(' ');

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('admin.leagues.requestAttach')}
        </h1>
        <p className="text-muted text-sm mt-1">{t('admin.leagues.attachDescription')}</p>
      </div>

      <div className="flex gap-1 border-b border-border mb-6">
        <button onClick={() => setTab('requests')} className={tabClass('requests')}>
          {t('admin.leagues.tabs.requests')}
        </button>
        <button onClick={() => setTab('memberships')} className={tabClass('memberships')}>
          {t('admin.leagues.tabs.memberships')}
        </button>
      </div>

      {tab === 'requests' ? (
        <RequestsTab eventId={params.eventId} apiUrl={apiUrl} />
      ) : (
        <MembershipsTab eventId={params.eventId} apiUrl={apiUrl} />
      )}
    </main>
  );
}
