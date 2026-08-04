'use client';

import { useMemo, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { AccountSection } from './AccountSection';
import { AISettingsSection } from './AISettingsSection';
import { LegalSection } from './LegalSection';
import { NotificationPreferences } from './NotificationPreferences';
import { PrivacySettings } from './PrivacySettings';

/**
 * Consolidated personal-space settings hub (mockup frame 17). Resolves the API
 * base URL on the client (browser value) rather than receiving a server-side
 * `getPublicApiUrl()` — passing the server value to a client island would leak the
 * internal `http://api:4000` host to the browser.
 */
export default function SettingsClient() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.meSettings.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.meSettings.subtitle')}</p>
        </header>

        <NotificationPreferences apiUrl={apiUrl} />
        <PrivacySettings apiUrl={apiUrl} />
        <AISettingsSection apiUrl={apiUrl} />
        <LegalSection apiUrl={apiUrl} />
        <AccountSection apiUrl={apiUrl} />

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-danger/60 hover:bg-danger/10 disabled:cursor-wait disabled:opacity-70"
        >
          {loggingOut
            ? t('publicApp.personalShell.loggingOut')
            : t('publicApp.meSettings.account.logout')}
        </button>
      </div>
    </main>
  );
}
