'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { ReactNode } from 'react';

/** Whether the person teaches a Workshop or attends it: the event overview's list and the
 *  Schedule tab's cards say it with this one chip. */
export function WorkshopRoleChip({ role }: { role: 'teaching' | 'attending' }): ReactNode {
  const { t } = useI18n();
  return role === 'teaching' ? (
    <span className="shrink-0 rounded-full bg-instructor/15 px-2 py-0.5 text-[11px] font-bold text-instructor">
      {t('publicApp.me.events.roleInstructor')}
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
      {t('publicApp.me.events.roleParticipant')}
    </span>
  );
}
