'use client';

import * as Sentry from '@sentry/nextjs';
import { t } from '@myclash/i18n';
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
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main role="alert" className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-lg font-semibold text-gray-900">{t('common.error')}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        {t('offline.tryAgain')}
      </button>
    </main>
  );
}
