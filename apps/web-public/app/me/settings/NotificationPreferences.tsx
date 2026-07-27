'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Switch } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingRow, Stepper } from './controls';

/** Mirrors the API's NotificationPreferencesResponse (all numbers/booleans). */
interface Prefs {
  matchStartingMinutesBefore: number;
  workshopStartingMinutesBefore: number;
  refereeStartingMinutesBefore: number;
  scheduleChanges: boolean;
  resultsPublished: boolean;
  organizerUpdates: boolean;
  enabled: boolean;
}

type Status = 'loading' | 'ready' | 'signin' | 'error';

/**
 * Granular notification preferences over the existing (and tested)
 * `GET/PATCH /api/v1/notifications/preferences` backend. Kept separate from
 * NotificationSettingsClient (push permission + broadcast inbox), which is
 * shared with the public `/notifications` page.
 */
export function NotificationPreferences({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/notifications/preferences`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          setStatus('signin');
          return;
        }
        if (!res.ok) throw new Error('load');
        setPrefs((await res.json()) as Prefs);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  // Optimistic PATCH: apply locally, reconcile with the server's canonical
  // response, revert on failure.
  async function patch(partial: Partial<Prefs>) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...partial });
    setSaveError(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/notifications/preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error('save');
      setPrefs((await res.json()) as Prefs);
    } catch {
      setPrefs(previous);
      setSaveError(true);
    }
  }

  const fmtLead = (v: number) =>
    v === 0
      ? t('publicApp.meSettings.notif.immediate')
      : t('publicApp.meSettings.notif.minutesBefore', { count: v });

  const decLabel = t('publicApp.meSettings.notif.decrease');
  const incLabel = t('publicApp.meSettings.notif.increase');

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('publicApp.meSettings.sectionNotifications')}
        </h2>
        <Link
          href="/me/notifications"
          className="text-xs font-semibold text-accent hover:underline"
        >
          {t('publicApp.meSettings.notif.inboxLink')}
        </Link>
      </div>

      {status === 'loading' && <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>}
      {status === 'signin' && (
        <p className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">
          {t('publicApp.meSettings.notif.signInRequired')}
        </p>
      )}
      {status === 'error' && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.meSettings.notif.loadError')}
        </p>
      )}

      {status === 'ready' && prefs && (
        <>
          <div className="mt-3 divide-y divide-border">
            <SettingRow
              label={t('publicApp.meSettings.notif.enabledLabel')}
              description={t('publicApp.meSettings.notif.enabledDescription')}
              control={
                <Switch
                  checked={prefs.enabled}
                  onChange={(v) => void patch({ enabled: v })}
                  ariaLabel={t('publicApp.meSettings.notif.enabledLabel')}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.leadMatch')}
              control={
                <Stepper
                  value={prefs.matchStartingMinutesBefore}
                  onChange={(v) => void patch({ matchStartingMinutesBefore: v })}
                  disabled={!prefs.enabled}
                  formatValue={fmtLead}
                  ariaLabel={t('publicApp.meSettings.notif.leadMatch')}
                  decLabel={decLabel}
                  incLabel={incLabel}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.leadReferee')}
              control={
                <Stepper
                  value={prefs.refereeStartingMinutesBefore}
                  onChange={(v) => void patch({ refereeStartingMinutesBefore: v })}
                  disabled={!prefs.enabled}
                  formatValue={fmtLead}
                  ariaLabel={t('publicApp.meSettings.notif.leadReferee')}
                  decLabel={decLabel}
                  incLabel={incLabel}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.leadWorkshop')}
              control={
                <Stepper
                  value={prefs.workshopStartingMinutesBefore}
                  onChange={(v) => void patch({ workshopStartingMinutesBefore: v })}
                  disabled={!prefs.enabled}
                  formatValue={fmtLead}
                  ariaLabel={t('publicApp.meSettings.notif.leadWorkshop')}
                  decLabel={decLabel}
                  incLabel={incLabel}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.scheduleChanges')}
              description={t('publicApp.meSettings.notif.scheduleChangesDescription')}
              control={
                <Switch
                  checked={prefs.scheduleChanges}
                  onChange={(v) => void patch({ scheduleChanges: v })}
                  disabled={!prefs.enabled}
                  ariaLabel={t('publicApp.meSettings.notif.scheduleChanges')}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.resultsPublished')}
              description={t('publicApp.meSettings.notif.resultsPublishedDescription')}
              control={
                <Switch
                  checked={prefs.resultsPublished}
                  onChange={(v) => void patch({ resultsPublished: v })}
                  disabled={!prefs.enabled}
                  ariaLabel={t('publicApp.meSettings.notif.resultsPublished')}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.notif.organizerUpdates')}
              description={t('publicApp.meSettings.notif.organizerUpdatesDescription')}
              control={
                <Switch
                  checked={prefs.organizerUpdates}
                  onChange={(v) => void patch({ organizerUpdates: v })}
                  disabled={!prefs.enabled}
                  ariaLabel={t('publicApp.meSettings.notif.organizerUpdates')}
                />
              }
            />
          </div>
          {saveError && (
            <p
              className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {t('publicApp.meSettings.notif.saveError')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
