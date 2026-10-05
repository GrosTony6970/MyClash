'use client';

import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The whole screen of a landing page that could not read `/api/v1/me` (operator
 * ruling 295a). The shells keep their page and show `IdentityUnverifiedBanner`;
 * a landing page has no page to keep, so it says so and offers the one way on.
 */
export function IdentityUnchecked() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div role="status" className="max-w-md text-center">
        <p className="text-sm text-muted">{t('common.identityUnchecked')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          {t('common.identityRetry')}
        </Button>
      </div>
    </main>
  );
}
