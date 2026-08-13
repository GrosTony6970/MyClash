'use client';

import { useRouter } from 'next/navigation';
import { createContext, Fragment, useContext, useMemo, useTransition, type ReactNode } from 'react';
import {
  createTranslator,
  defaultLocale,
  getMessages,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
  type TranslationValues,
} from '@myclash/i18n';

/**
 * The client half of the locale layer, shared by web-admin, web-public and
 * web-staff. Each app carried a byte-identical copy of this file and of the
 * switcher until they were folded together here.
 *
 * It cannot live in @myclash/i18n: that package is framework-agnostic on
 * purpose — `negotiateLocale`'s own docstring says so, and web-marketing's
 * Astro build and the NestJS API both depend on it staying that way. This half
 * needs React and next/navigation, so it gets its own package rather than
 * dragging Next into a data package.
 */
export type Translator = (key: string, values?: TranslationValues) => string;

export type I18nContextValue = {
  locale: Locale;
  t: Translator;
};

/**
 * Seeded eagerly rather than left undefined. Component tests in web-admin and
 * web-staff render `useI18n` consumers with no provider above them and rely on
 * getting a working translator; a throwing hook would be the more usual
 * hardening and would turn those suites red for no defect.
 */
const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  t: createTranslator(getMessages(defaultLocale)),
});

export function I18nProvider({
  children,
  locale = defaultLocale,
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(getMessages(locale)),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

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
