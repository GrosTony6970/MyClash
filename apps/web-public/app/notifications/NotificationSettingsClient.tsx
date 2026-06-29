'use client';

import { useEffect, useState } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { markBroadcastsSeen } from '../../src/components/me/useUnreadBroadcasts';

type PermissionStateLabel = NotificationPermission | 'unsupported' | 'loading';

interface Props {
  apiUrl: string;
  embedded?: boolean;
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
  info: 'border-info/40 bg-info/10 text-info',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  alert: 'border-danger/40 bg-danger/10 text-danger',
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

export default function NotificationSettingsClient({ apiUrl, embedded = false }: Props) {
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
        // Opening the inbox marks everything delivered so far as read and
        // clears the unread badge in the personal-shell nav.
        markBroadcastsSeen();
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
        setMessage(t('publicApp.notifications.msgNotEnabled'));
        return;
      }

      const keyResponse = await fetch(`${apiUrl}/api/v1/notifications/vapid-public-key`, {
        credentials: 'include',
      });
      if (!keyResponse.ok) throw new Error(t('publicApp.notifications.errKeysNotConfigured'));

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
        throw new Error(t('publicApp.notifications.errIncompleteSubscription'));
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
        throw new Error(t('publicApp.notifications.errSignInRequired'));
      }
      if (!response.ok) throw new Error(t('publicApp.notifications.errSaveSubscription'));

      const saved = (await response.json()) as SubscribeResponse;
      setSubscriptionId(saved.id);
      setEnabled(true);
      setMessage(t('publicApp.notifications.msgEnabled'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('publicApp.notifications.errEnable'));
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
      setMessage(t('publicApp.notifications.msgDisabled'));
    } catch {
      setMessage(t('publicApp.notifications.errDisable'));
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

  const content = (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6">
      {!embedded && (
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            {t('publicApp.name')}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
            {t('publicApp.notifications.title')}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {t('publicApp.notifications.description')}
          </p>
        </header>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {t('publicApp.notifications.deviceStatus')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">{statusText}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              enabled ? 'bg-success/15 text-success' : 'bg-foreground/10 text-muted'
            }`}
          >
            {enabled ? t('publicApp.notifications.enabled') : t('publicApp.notifications.off')}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            disabled={!canEnable || busy}
            loading={busy && !enabled}
            onClick={() => void enableNotifications()}
          >
            {t('publicApp.notifications.enable')}
          </Button>
          <button
            type="button"
            disabled={!canDisable || busy}
            onClick={() => void disableNotifications()}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && enabled
              ? t('publicApp.notifications.disabling')
              : t('publicApp.notifications.disable')}
          </button>
        </div>

        {message && <p className="mt-4 text-sm text-muted">{message}</p>}
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t('publicApp.notifications.broadcastHistory')}
        </h2>
        {broadcastError && <p className="mt-3 text-sm text-danger">{broadcastError}</p>}
        {!broadcastError && broadcasts.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('publicApp.notifications.noBroadcasts')}</p>
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
  );

  if (embedded) {
    return content;
  }

  return <main className="min-h-screen bg-background px-4 py-8 text-foreground">{content}</main>;
}
