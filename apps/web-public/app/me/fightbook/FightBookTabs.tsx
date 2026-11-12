'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { SegmentedTabs } from '@myclash/ui';
import { answered, blocked, cancelled, hearted, withdrawn } from './fightbook-patches';
import { FavouritesTab } from './FavouritesTab';
import { FindTab } from './FindTab';
import { InboxTab } from './InboxTab';
import { MySparsTab } from './MySparsTab';
import type { FightBookData } from './use-fightbook';
import { afterHandlers } from './use-spar-after';

type Tab = 'inbox' | 'spars' | 'favourites' | 'find';

/** The tab in the URL (`?tab=`), as the People hub's. */
function useTab(): [Tab, (next: Tab) => void] {
  const router = useRouter();
  const asked = useSearchParams().get('tab');
  const tab: Tab =
    asked === 'spars' || asked === 'favourites' || asked === 'find' ? asked : 'inbox';
  const setTab = (next: Tab) =>
    router.replace(next === 'inbox' ? '/me/fightbook' : `/me/fightbook?tab=${next}`, {
      scroll: false,
    });
  return [tab, setTab];
}

function TabBar(props: { tab: Tab; onChange: (next: Tab) => void; inboxCount: number }) {
  const { t } = useI18n();
  const inboxLabel =
    props.inboxCount > 0
      ? t('publicApp.fightBook.tabs.inboxCount', { count: String(props.inboxCount) })
      : t('publicApp.fightBook.tabs.inbox');
  return (
    <SegmentedTabs<Tab>
      aria-label={t('publicApp.fightBook.tabs.label')}
      value={props.tab}
      onChange={props.onChange}
      tabs={[
        { value: 'inbox', label: inboxLabel },
        { value: 'spars', label: t('publicApp.fightBook.tabs.spars') },
        { value: 'favourites', label: t('publicApp.fightBook.tabs.favourites') },
        { value: 'find', label: t('publicApp.fightBook.tabs.find') },
      ]}
    />
  );
}

/**
 * The Inbox, My spars, Favourites (ruling 679) and Find a partner. The tab lives in the URL
 * (`?tab=`), as the People hub's does. Every write patches the
 * page's data from its own answer (`fightbook-patches.ts`); an ask sent from Find reads the page
 * again behind it, so My spars shows the new request.
 */
export function FightBookTabs(props: {
  apiUrl: string;
  data: FightBookData;
  update: (change: (data: FightBookData) => Partial<FightBookData>) => void;
  /** A write found the page stale (`not_open`): read it again behind the page. */
  refresh: () => void;
}) {
  const [tab, setTab] = useTab();
  const onHearted = (id: string, favourite: boolean) => props.update(hearted(id, favourite));
  return (
    <div className="flex flex-col gap-4">
      <TabBar tab={tab} onChange={setTab} inboxCount={props.data.inbox.length} />
      {tab === 'inbox' ? (
        <InboxTab
          apiUrl={props.apiUrl}
          inbox={props.data.inbox}
          onAnswered={(request, status) => props.update(answered(request, status))}
          onBlocked={(asker) => props.update(blocked(asker))}
          onStale={props.refresh}
        />
      ) : null}
      {tab === 'spars' ? (
        <MySparsTab
          apiUrl={props.apiUrl}
          spars={props.data.spars}
          onWithdrawn={(id) => props.update(withdrawn(id))}
          onCancelled={(id, message) => props.update(cancelled(id, message))}
          onHearted={onHearted}
          {...afterHandlers(props.update, props.refresh)}
        />
      ) : null}
      {tab === 'favourites' ? (
        <FavouritesTab apiUrl={props.apiUrl} onSent={props.refresh} onHearted={onHearted} />
      ) : null}
      {tab === 'find' ? (
        <FindTab apiUrl={props.apiUrl} onSent={props.refresh} onHearted={onHearted} />
      ) : null}
    </div>
  );
}
