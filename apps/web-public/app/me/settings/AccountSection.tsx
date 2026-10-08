'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchMe } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { SettingRow } from './controls';

/**
 * Account block of the settings hub: current email (read-only), a display-only
 * language row, and links to the security page where email, password, and
 * account deletion are managed. The email-change flow now lives on /me/security
 * (see EmailChangeSection); this section just links there. The address is the one `/me`
 * hands, which answers while the auth server is silent (ruling 353).
 */
export function AccountSection({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMe(apiUrl, { signal: controller.signal }).then((me) => {
      if (me.ok) setEmail(me.data.user?.email || null);
    });
    return () => controller.abort();
  }, [apiUrl]);

  const linkRow =
    'flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-foreground/5';

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.meSettings.sectionAccount')}
      </h2>

      <div className="mt-3 divide-y divide-border">
        <SettingRow
          label={t('publicApp.meSettings.account.emailLabel')}
          control={
            <span className="break-all text-sm font-medium text-muted">
              {email ?? t('common.unknown')}
            </span>
          }
        />
        <SettingRow
          label={t('publicApp.meSettings.account.languageLabel')}
          description={t('publicApp.meSettings.account.languageNote')}
          control={
            <span className="text-sm font-medium text-muted">
              {locale === 'fr'
                ? t('publicApp.meSettings.account.languageFrench')
                : t('publicApp.meSettings.account.languageEnglish')}
            </span>
          }
        />
      </div>

      <div className="mt-4 space-y-2">
        <Link href="/me/security" className={linkRow}>
          <span>{t('publicApp.meSettings.account.emailLink')}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
        <Link href="/me/security" className={linkRow}>
          <span>{t('publicApp.meSettings.account.passwordLink')}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
        <Link href="/me/security" className={linkRow}>
          <span>{t('publicApp.meSettings.account.deleteLink')}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
      </div>
    </section>
  );
}
