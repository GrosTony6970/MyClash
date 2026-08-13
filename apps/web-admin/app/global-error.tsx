'use client';

import * as Sentry from '@sentry/nextjs';
// The EN-bound module `t`, on purpose — and the only place it is still the
// right call in a client component. global-error replaces the ROOT LAYOUT, so
// I18nProvider is not above it and useI18n() would read the context default
// anyway. The hard-coded <html lang="en"> below says the same thing.
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
