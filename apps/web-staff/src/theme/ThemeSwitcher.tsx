'use client';

import { Fragment, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from './ThemeProvider';
import { SCORING_THEMES, THEME_COOKIE, type ScoringTheme } from './theme';

const LABEL_KEY: Record<ScoringTheme, string> = {
  hybrid: 'scoring.theme.hybrid',
  dark: 'scoring.theme.dark',
  light: 'scoring.theme.light',
};

const ICON: Record<ScoringTheme, string> = {
  hybrid: '◐',
  dark: '●',
  light: '○',
};

// Module scope on purpose: writing document.cookie inside the component trips
// the React Compiler ("this value cannot be modified"). Same reason and same
// shape as persistLocale in ../i18n/LanguageSwitcher.tsx. One year, lax so the
// cookie rides top-level navigations.
function persistTheme(next: ScoringTheme) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Hybrid / Dark / Light selector. Persists to the `mc_theme` cookie and
 * refreshes so the SERVER re-renders: the root layout re-reads the cookie and
 * emits the new `<body data-theme>`, and the refreshed ThemeProvider hands the
 * new scopes to the chrome regions and to the JS-coloured components.
 *
 * That round trip is why nothing here touches the DOM directly — one owner for
 * the attribute (the layout), so a client-side write can never disagree with
 * what the server rendered.
 */
export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { mode } = useScoringTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: ScoringTheme) {
    if (next === mode || pending) return;
    persistTheme(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t('scoring.theme.switcher')}
      data-testid="theme-switcher"
      className={`inline-flex items-center gap-1 text-xs font-semibold ${className}`}
    >
      {SCORING_THEMES.map((option, i) => (
        <Fragment key={option}>
          {i > 0 && (
            <span aria-hidden className="text-border">
              /
            </span>
          )}
          <button
            type="button"
            onClick={() => choose(option)}
            aria-pressed={option === mode}
            disabled={pending}
            data-theme-option={option}
            title={t(LABEL_KEY[option])}
            aria-label={t(LABEL_KEY[option])}
            className={`transition-colors disabled:opacity-60 ${
              option === mode ? 'text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            <span aria-hidden>{ICON[option]}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
