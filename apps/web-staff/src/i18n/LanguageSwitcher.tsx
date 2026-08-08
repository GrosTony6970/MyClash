'use client';

import { Fragment, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from '@myclash/i18n';
import { useI18n } from './I18nProvider';

const LABEL_KEY: Record<Locale, string> = {
  en: 'navigation.languageEnglish',
  fr: 'navigation.languageFrench',
};

// Module scope on purpose: writing document.cookie inside the component trips
// the React Compiler ("this value cannot be modified"). One year, lax so the
// cookie rides top-level navigations.
function persistLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * EN / FR language toggle. Persists the choice in the `mc_locale` cookie (one
 * year, lax) and refreshes so the server re-renders in the chosen locale — the
 * root layout re-resolves the cookie and feeds the new locale to `<html lang>`
 * and the client I18nProvider.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale || pending) return;
    persistLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t('navigation.languageSwitcher')}
      className={`inline-flex items-center gap-1 text-xs font-semibold ${className}`}
    >
      {SUPPORTED_LOCALES.map((loc, i) => (
        <Fragment key={loc}>
          {i > 0 && (
            <span aria-hidden className="text-border">
              /
            </span>
          )}
          <button
            type="button"
            onClick={() => choose(loc)}
            aria-pressed={loc === locale}
            disabled={pending}
            title={t(LABEL_KEY[loc])}
            className={`uppercase transition-colors disabled:opacity-60 ${
              loc === locale ? 'text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            {loc}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
