'use client';

import { useEffect, useState } from 'react';
import { Switch } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { SettingRow } from './controls';

interface Privacy {
  hideWorkshopsPublicly: boolean;
  allowBeingFollowed: boolean;
  showRealEmailToFollowers: boolean;
}

type Status = 'loading' | 'ready' | 'signin' | 'error';

/**
 * Privacy preferences over the existing `GET/PATCH /api/v1/persons/me/privacy`
 * backend (previously had no UI anywhere). Scoped to the account's single
 * claimed person — see the scope note copy.
 */
export function PrivacySettings({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/persons/me/privacy`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          setStatus('signin');
          return;
        }
        if (!res.ok) throw new Error('load');
        setPrivacy((await res.json()) as Privacy);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  async function patch(partial: Partial<Privacy>) {
    if (!privacy) return;
    const previous = privacy;
    setPrivacy({ ...privacy, ...partial });
    setSaveError(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/persons/me/privacy`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error('save');
      setPrivacy((await res.json()) as Privacy);
    } catch {
      setPrivacy(previous);
      setSaveError(true);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.meSettings.sectionPrivacy')}
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted">
        {t('publicApp.meSettings.privacy.scopeNote')}
      </p>

      {status === 'loading' && <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>}
      {status === 'signin' && (
        <p className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">
          {t('publicApp.meSettings.privacy.signInRequired')}
        </p>
      )}
      {status === 'error' && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.meSettings.privacy.loadError')}
        </p>
      )}

      {status === 'ready' && privacy && (
        <>
          <div className="mt-3 divide-y divide-border">
            <SettingRow
              label={t('publicApp.meSettings.privacy.hideWorkshops')}
              description={t('publicApp.meSettings.privacy.hideWorkshopsDescription')}
              control={
                <Switch
                  checked={privacy.hideWorkshopsPublicly}
                  onChange={(v) => void patch({ hideWorkshopsPublicly: v })}
                  ariaLabel={t('publicApp.meSettings.privacy.hideWorkshops')}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.privacy.allowFollows')}
              description={t('publicApp.meSettings.privacy.allowFollowsDescription')}
              control={
                <Switch
                  checked={privacy.allowBeingFollowed}
                  onChange={(v) => void patch({ allowBeingFollowed: v })}
                  ariaLabel={t('publicApp.meSettings.privacy.allowFollows')}
                />
              }
            />
            <SettingRow
              label={t('publicApp.meSettings.privacy.showEmailToFollowers')}
              description={t('publicApp.meSettings.privacy.showEmailToFollowersDescription')}
              control={
                <Switch
                  checked={privacy.showRealEmailToFollowers}
                  onChange={(v) => void patch({ showRealEmailToFollowers: v })}
                  ariaLabel={t('publicApp.meSettings.privacy.showEmailToFollowers')}
                />
              }
            />
          </div>
          {saveError && (
            <p
              className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {t('publicApp.meSettings.privacy.saveError')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
