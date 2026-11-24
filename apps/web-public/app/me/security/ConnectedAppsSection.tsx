'use client';

/**
 * ConnectedAppsSection — the AI apps (Claude) connected to this account, and a way to
 * disconnect each one. Extracted from page.tsx for the same reason as DataAndPrivacySection:
 * the page is already past the file cap.
 *
 * A disconnect ends the app's refresh, but an access token it already holds lives up to an
 * hour: the section says so. The app's id is only a React key and the disconnect argument.
 */

import { useEffect, useState } from 'react';
import { Button, Spinner } from '@myclash/ui';
import type { ConnectedApp } from '@myclash/types';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { signInAgainHere } from '@/lib/sign-in-return';
import { readConnectedApps, requestDisconnectApp } from './security-requests';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; apps: ConnectedApp[] };

/**
 * The list, and the disconnect of one row. `busy` holds the ids with a disconnect in flight
 * (a row's button is off until its own answer); `failedName` names the app whose disconnect
 * failed, and its row stays.
 */
function useConnectedApps(apiUrl: string) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failedName, setFailedName] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // setState stays inside the promise callback: react-hooks/set-state-in-effect.
    void readConnectedApps(apiUrl, controller.signal).then((read) => {
      if (read === 'aborted') return;
      if (read === 'session_ended') signInAgainHere();
      else if (read === 'failed') setLoad({ state: 'error' });
      else setLoad({ state: 'ready', apps: read.apps });
    });
    return () => controller.abort();
  }, [apiUrl]);

  async function disconnect(app: ConnectedApp): Promise<void> {
    setFailedName(null);
    setBusy((current) => new Set(current).add(app.clientId));
    const answer = await requestDisconnectApp(apiUrl, app.clientId);
    setBusy((current) => {
      const next = new Set(current);
      next.delete(app.clientId);
      return next;
    });
    if (answer === 'ok') {
      setLoad((current) =>
        current.state === 'ready'
          ? { state: 'ready', apps: current.apps.filter((a) => a.clientId !== app.clientId) }
          : current,
      );
    } else if (answer === 'session_ended') signInAgainHere();
    else setFailedName(app.name);
  }

  return { load, busy, failedName, disconnect };
}

function AppRow({
  app,
  busy,
  onDisconnect,
}: {
  app: ConnectedApp;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const { t, locale } = useI18n();
  const granted = new Date(app.grantedAt);
  const day = Number.isNaN(granted.getTime())
    ? app.grantedAt
    : granted.toLocaleDateString(localeToBcp47(locale), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{app.name}</p>
        <p className="text-xs text-muted">{t('publicApp.connectedApps.granted', { date: day })}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={onDisconnect}
        disabled={busy}
        loading={busy}
      >
        {t('publicApp.connectedApps.disconnect')}
      </Button>
    </li>
  );
}

export function ConnectedAppsSection({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const { load, busy, failedName, disconnect } = useConnectedApps(apiUrl);

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('publicApp.connectedApps.title')}
      </h2>

      {load.state === 'loading' && (
        <Spinner size="md" className="mt-3 text-muted" label={t('common.loading')} />
      )}
      {load.state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t('publicApp.connectedApps.loadError')}
        </p>
      )}
      {load.state === 'ready' && load.apps.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t('publicApp.connectedApps.none')}</p>
      )}
      {load.state === 'ready' && load.apps.length > 0 && (
        <>
          <ul className="mt-3 divide-y divide-border">
            {load.apps.map((app) => (
              <AppRow
                key={app.clientId}
                app={app}
                busy={busy.has(app.clientId)}
                onDisconnect={() => void disconnect(app)}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">{t('publicApp.connectedApps.lag')}</p>
        </>
      )}
      {failedName !== null && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t('publicApp.connectedApps.disconnectError', { name: failedName })}
        </p>
      )}
    </section>
  );
}
