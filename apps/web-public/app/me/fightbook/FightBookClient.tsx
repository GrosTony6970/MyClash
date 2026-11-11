'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import type { MySpars } from '@myclash/types';
import { Button, Spinner } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { ReadFailed } from '@/components/me/ReadFailed';
import { FightBookSettingsPanel, FightBookSwitch } from './FightBookSettingsPanel';
import { FightBookTabs } from './FightBookTabs';
import { cancelled, unblocked, withdrawn } from './fightbook-patches';
import { MySparsTab } from './MySparsTab';
import { useFightBook, type FightBookState } from './use-fightbook';

/**
 * `/me/fightbook` — FightBook (slice 1). A fighter with no profile is sent to claim one; while
 * FightBook is off, the page says what it is and shows the switch, and My spars; once on, the
 * settings panel and the fighters they blocked. The Inbox and My spars tabs sit above the panel.
 */
export function FightBookClient() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const { state, reload, refresh, update } = useFightBook(apiUrl);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.fightBook.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.fightBook.subtitle')}</p>
        </header>
        <Body apiUrl={apiUrl} state={state} reload={reload} refresh={refresh} update={update} />
      </div>
    </main>
  );
}

/** FightBook needs a fighter profile: the way to claim one is the personal space. */
function NoProfile() {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.fightBook.noProfile.title')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.fightBook.noProfile.body')}</p>
      <Button asChild className="mt-4">
        <Link href="/me">{t('publicApp.fightBook.noProfile.action')}</Link>
      </Button>
    </section>
  );
}

/**
 * What FightBook is, and the switch. Under it, My spars when it holds any: a fighter who switched
 * off still sees the spars they agreed and can cancel one (ruling 666).
 */
function SwitchedOff({
  apiUrl,
  onOn,
  spars,
  refresh,
  update,
}: {
  apiUrl: string;
  onOn: () => void;
  spars: MySpars;
} & Pick<ReturnType<typeof useFightBook>, 'refresh' | 'update'>) {
  const { t } = useI18n();
  return (
    <>
      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('publicApp.fightBook.off.title')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.fightBook.off.body')}</p>
        <FightBookSwitch apiUrl={apiUrl} enabled={false} onSaved={(on) => on && onOn()} />
      </section>
      {spars.spars.length + spars.sent.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {t('publicApp.fightBook.tabs.spars')}
          </h2>
          <MySparsTab
            apiUrl={apiUrl}
            spars={spars}
            onWithdrawn={(id) => update(withdrawn(id))}
            onCancelled={(id, message) => update(cancelled(id, message))}
            onStale={refresh}
          />
        </section>
      ) : null}
    </>
  );
}

function Body({
  apiUrl,
  state,
  reload,
  refresh,
  update,
}: {
  apiUrl: string;
  state: FightBookState;
} & Pick<ReturnType<typeof useFightBook>, 'reload' | 'refresh' | 'update'>) {
  const { t } = useI18n();
  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'failed') {
    return <ReadFailed title={t('publicApp.fightBook.loadFailed')} onRetry={reload} />;
  }
  if (!state.settings.hasProfile) return <NoProfile />;
  if (!state.settings.enabled) {
    return (
      <SwitchedOff
        apiUrl={apiUrl}
        onOn={reload}
        spars={state.spars}
        refresh={refresh}
        update={update}
      />
    );
  }
  return (
    <>
      <FightBookTabs apiUrl={apiUrl} data={state} update={update} refresh={refresh} />
      <FightBookSettingsPanel
        apiUrl={apiUrl}
        blocks={state.blocks}
        onSwitched={reload}
        onUnblocked={(id) => update(unblocked(id))}
      />
    </>
  );
}
