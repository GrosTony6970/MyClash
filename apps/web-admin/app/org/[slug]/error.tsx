'use client';

import * as Sentry from '@sentry/nextjs';
import { t } from '@myclash/i18n';
import { useEffect } from 'react';

/** Segment error boundary for the organizer area — friendly retry card instead of the Next crash screen. */
export default function OrgSegmentError({
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
      <h1 className="text-lg font-semibold text-foreground">{t('common.error')}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
      >
        {t('offline.tryAgain')}
      </button>
    </main>
  );
}
