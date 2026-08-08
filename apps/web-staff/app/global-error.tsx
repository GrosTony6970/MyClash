'use client';

import * as Sentry from '@sentry/nextjs';
import { t } from '@myclash/i18n';
import { useEffect } from 'react';

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main role="alert">
          <h1>{t('common.error')}</h1>
          <button type="button" onClick={reset}>
            {t('offline.tryAgain')}
          </button>
        </main>
      </body>
    </html>
  );
}
