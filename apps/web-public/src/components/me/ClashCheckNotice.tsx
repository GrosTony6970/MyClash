'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * One line at the top of a schedule page saying how many of its commitments the
 * clash check cannot see, because their end is unknown (operator, 2026-09-18).
 * Each page counts its own cards with `uncheckedCount`; nothing shows at zero.
 */
export function ClashCheckNotice({ count }: { count: number }): ReactNode {
  const { t } = useI18n();
  if (count === 0) return null;
  return (
    <p role="status" className="mb-3 text-sm font-medium text-warning">
      {t(
        count === 1
          ? 'publicApp.me.schedule.clashCheckIncompleteOne'
          : 'publicApp.me.schedule.clashCheckIncomplete',
        { count },
      )}
    </p>
  );
}
