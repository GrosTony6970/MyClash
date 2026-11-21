'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useOtherTablets } from '../offline/open-piste';

/**
 * Another tablet scores this piste (ruling 953): the server heard from it in
 * the last minute. A warning, never a lock — a tablet that broke is replaced by
 * another, and the referee decides which one goes on.
 */
export function OtherTabletBanner() {
  const { t } = useI18n();
  if (useOtherTablets() === 0) return null;
  return (
    <p
      role="status"
      data-testid="other-tablet-banner"
      className="border-b-2 border-warning bg-warning/15 px-4 py-2 text-sm font-semibold text-warning"
    >
      {t('scoring.otherTablet')}
    </p>
  );
}
