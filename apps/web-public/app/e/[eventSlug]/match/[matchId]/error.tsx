'use client';

import { useI18n } from '@myclash/next-i18n/client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Segment error boundary for the public match scoreboard. Without it, a render
 * error escalates to the root and returns a hard SSR 500. This scopes the
 * failure to a friendly retry card while keeping the surrounding shell.
 */
export default function MatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main role="alert" className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-lg font-semibold text-foreground">{t('common.error')}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
      >
        {t('offline.tryAgain')}
      </button>
    </main>
  );
}
