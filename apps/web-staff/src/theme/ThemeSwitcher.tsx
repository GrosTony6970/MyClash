'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from './ThemeProvider';
import { nextScoringTheme, THEME_COOKIE, type ScoringTheme } from './theme';

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
 * The theme button: Hybrid, Dark, Light, one tap each. It shows the theme the
 * tablet is in. It was three symbols of about 16px each; it is one touch
 * target of 44px (quick win P12; operator, 2026-10-12).
 *
 * Persists to the `mc_theme` cookie and refreshes so the SERVER re-renders:
 * the root layout re-reads the cookie and emits the new `<body data-theme>`,
 * and the refreshed ThemeProvider hands the new scopes to the chrome regions
 * and to the JS-coloured components.
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
  const next = nextScoringTheme(mode);

  function cycle() {
    if (pending) return;
    persistTheme(next);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      data-testid="theme-switcher"
      data-theme-mode={mode}
      onClick={cycle}
      disabled={pending}
      aria-label={t('scoring.theme.change', {
        current: t(LABEL_KEY[mode]),
        next: t(LABEL_KEY[next]),
      })}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:border-muted hover:bg-background disabled:opacity-60 ${className}`}
    >
      <span aria-hidden>{ICON[mode]}</span>
      {t(LABEL_KEY[mode])}
    </button>
  );
}
