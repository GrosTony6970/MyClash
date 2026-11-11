'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { Button, Spinner } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { ReadFailed } from '@/components/me/ReadFailed';
import { FightBookSettingsPanel, FightBookSwitch } from './FightBookSettingsPanel';
import { useFightBook, type FightBookState } from './use-fightbook';

/**
 * `/me/fightbook` — FightBook (slice 1). A fighter with no profile is sent to claim one; while
 * FightBook is off, the page says what it is and shows the switch; once on, the settings panel
 * and the fighters they blocked. The Inbox and My spars tabs sit above the panel.
 */
export function FightBookClient() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const { state, reload, update } = useFightBook(apiUrl);

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
        <Body apiUrl={apiUrl} state={state} reload={reload} update={update} />
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

/** What FightBook is, and the switch: nothing else shows until it is on. */
function SwitchedOff({ apiUrl, onOn }: { apiUrl: string; onOn: () => void }) {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.fightBook.off.title')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.fightBook.off.body')}</p>
      <FightBookSwitch apiUrl={apiUrl} enabled={false} onSaved={(on) => on && onOn()} />
    </section>
  );
}

function Body({
  apiUrl,
  state,
  reload,
  update,
}: {
  apiUrl: string;
  state: FightBookState;
} & Pick<ReturnType<typeof useFightBook>, 'reload' | 'update'>) {
  const { t } = useI18n();
  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'failed') {
    return <ReadFailed title={t('publicApp.fightBook.loadFailed')} onRetry={reload} />;
  }
  if (!state.settings.hasProfile) return <NoProfile />;
  if (!state.settings.enabled) return <SwitchedOff apiUrl={apiUrl} onOn={reload} />;
  return (
    <FightBookSettingsPanel
      apiUrl={apiUrl}
      blocks={state.blocks}
      onSwitched={reload}
      onUnblocked={(id) =>
        update((data) => ({ blocks: data.blocks.filter((b) => b.fighter.globalPersonId !== id) }))
      }
    />
  );
}
