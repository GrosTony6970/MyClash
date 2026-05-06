'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

type PermissionStateLabel = NotificationPermission | 'unsupported' | 'loading';

interface Props {
  apiUrl: string;
}

interface SubscribeResponse {
  id: string;
  endpoint: string;
}

type BroadcastSeverity = 'info' | 'warning' | 'alert';

interface BroadcastNotification {
  id: string;
  eventName: string | null;
  severity: BroadcastSeverity;
  title: string;
  body: string;
  createdAt: string;
}

const severityClasses: Record<BroadcastSeverity, string> = {
  info: 'border-green-500/40 bg-green-500/10 text-green-200',
  warning: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-100',
  alert: 'border-red-500/40 bg-red-500/10 text-red-100',
};

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return buffer;
}

export default function NotificationSettingsClient({ apiUrl }: Props) {
  const { t } = useI18n();
  const [permission, setPermission] = useState<PermissionStateLabel>('loading');
  const [busy, setBusy] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [broadcasts, setBroadcasts] = useState<BroadcastNotification[]>([]);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setPermission('unsupported');
        return;
      }

      setPermission(Notification.permission);
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => {
          setEnabled(Boolean(subscription));
        })
        .catch(() => {
          setPermission('unsupported');
        });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/notifications/broadcasts`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error('load failed');
        setBroadcasts((await response.json()) as BroadcastNotification[]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setBroadcastError(t('publicApp.notifications.loadBroadcastsError'));
      });
    return () => controller.abort();
  }, [apiUrl, t]);

  async function enableNotifications() {
    if (permission === 'unsupported' || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const nextPermission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      setPermission(nextPermission);

      if (nextPermission !== 'granted') {
        setMessage('Notifications were not enabled.');
        return;
      }

      const keyResponse = await fetch(`${apiUrl}/api/v1/notifications/vapid-public-key`, {
        credentials: 'include',
      });
      if (!keyResponse.ok) throw new Error('Notification keys are not configured.');

      const { publicKey } = (await keyResponse.json()) as { publicKey: string };
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToArrayBuffer(publicKey),
        }));

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error('Browser returned an incomplete push subscription.');
      }

      const response = await fetch(`${apiUrl}/api/v1/notifications/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
        }),
      });

      if (response.status === 401) {
        throw new Error('Sign in with your magic link before enabling push notifications.');
      }
      if (!response.ok) throw new Error('Could not save this notification subscription.');

      const saved = (await response.json()) as SubscribeResponse;
      setSubscriptionId(saved.id);
      setEnabled(true);
      setMessage('Push notifications are enabled.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();

      if (subscriptionId) {
        await fetch(`${apiUrl}/api/v1/notifications/subscribe/${subscriptionId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }

      setSubscriptionId(null);
      setEnabled(false);
      setMessage('Push notifications are disabled on this device.');
    } catch {
      setMessage('Could not disable notifications.');
    } finally {
      setBusy(false);
    }
  }

  const canEnable = permission !== 'unsupported' && permission !== 'denied' && !enabled;
  const canDisable = enabled;
  const statusText =
    permission === 'unsupported'
      ? t('publicApp.notifications.statusUnsupported')
      : permission === 'loading'
        ? t('publicApp.notifications.statusLoading')
        : enabled
          ? t('publicApp.notifications.statusEnabled')
          : permission === 'denied'
            ? t('publicApp.notifications.statusDenied')
            : permission === 'granted'
              ? t('publicApp.notifications.statusGranted')
              : t('publicApp.notifications.statusNeedsPermission');

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100">
      <section className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-red-300">
            {t('publicApp.name')}
          </p>
          <h1 className="mt-2 text-3xl font-bold">{t('publicApp.notifications.title')}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            {t('publicApp.notifications.description')}
          </p>
        </header>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">
                {t('publicApp.notifications.deviceStatus')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-zinc-400">{statusText}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                enabled ? 'bg-green-500/15 text-green-300' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              {enabled ? t('publicApp.notifications.enabled') : t('publicApp.notifications.off')}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!canEnable || busy}
              onClick={() => void enableNotifications()}
              className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              {busy && !enabled
                ? t('publicApp.notifications.enabling')
                : t('publicApp.notifications.enable')}
            </button>
            <button
              type="button"
              disabled={!canDisable || busy}
              onClick={() => void disableNotifications()}
              className="rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-500"
            >
              {busy && enabled
                ? t('publicApp.notifications.disabling')
                : t('publicApp.notifications.disable')}
            </button>
          </div>

          {message && <p className="mt-4 text-sm text-zinc-300">{message}</p>}
        </div>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-base font-semibold">
            {t('publicApp.notifications.broadcastHistory')}
          </h2>
          {broadcastError && <p className="mt-3 text-sm text-red-300">{broadcastError}</p>}
          {!broadcastError && broadcasts.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">
              {t('publicApp.notifications.noBroadcasts')}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {broadcasts.map((broadcast) => (
                <article
                  key={broadcast.id}
                  className={`rounded-lg border p-3 ${severityClasses[broadcast.severity]}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-bold uppercase">
                      {t(`publicApp.notifications.${broadcast.severity}`)}
                    </span>
                    {broadcast.eventName && (
                      <span className="text-xs opacity-80">
                        {t('publicApp.notifications.fromEvent', { event: broadcast.eventName })}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 font-semibold">{broadcast.title}</h3>
                  <p className="mt-1 text-sm opacity-90">{broadcast.body}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
