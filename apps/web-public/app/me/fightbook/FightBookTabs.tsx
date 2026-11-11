'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { SegmentedTabs } from '@myclash/ui';
import { answered, blocked, cancelled, withdrawn } from './fightbook-patches';
import { InboxTab } from './InboxTab';
import { MySparsTab } from './MySparsTab';
import type { FightBookData } from './use-fightbook';

type Tab = 'inbox' | 'spars';

/**
 * The two tabs of slice 1 (ruling 664: Favourites and Find a partner arrive with their slices).
 * The tab lives in the URL (`?tab=`), as the People hub's does. Every write patches the page's
 * data from its own answer (`fightbook-patches.ts`).
 */
export function FightBookTabs(props: {
  apiUrl: string;
  data: FightBookData;
  update: (change: (data: FightBookData) => Partial<FightBookData>) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const tab: Tab = useSearchParams().get('tab') === 'spars' ? 'spars' : 'inbox';
  const count = props.data.inbox.length;
  const setTab = (next: Tab) =>
    router.replace(next === 'inbox' ? '/me/fightbook' : '/me/fightbook?tab=spars', {
      scroll: false,
    });
  const inboxLabel =
    count > 0
      ? t('publicApp.fightBook.tabs.inboxCount', { count: String(count) })
      : t('publicApp.fightBook.tabs.inbox');

  return (
    <div className="flex flex-col gap-4">
      <SegmentedTabs<Tab>
        aria-label={t('publicApp.fightBook.tabs.label')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'inbox', label: inboxLabel },
          { value: 'spars', label: t('publicApp.fightBook.tabs.spars') },
        ]}
      />
      {tab === 'inbox' ? (
        <InboxTab
          apiUrl={props.apiUrl}
          inbox={props.data.inbox}
          onAnswered={(request, status) => props.update(answered(request, status))}
          onBlocked={(asker) => props.update(blocked(asker))}
        />
      ) : (
        <MySparsTab
          apiUrl={props.apiUrl}
          spars={props.data.spars}
          onWithdrawn={(id) => props.update(withdrawn(id))}
          onCancelled={(id, message) => props.update(cancelled(id, message))}
        />
      )}
    </div>
  );
}
