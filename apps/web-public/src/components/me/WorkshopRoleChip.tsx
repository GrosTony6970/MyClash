'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { ReactNode } from 'react';

/**
 * Whether the person teaches a Workshop or attends it: the event overview's list and the
 * Schedule tab's cards say it with this one chip.
 *
 * The chip's 15% wash sits on an opaque page-coloured base. The status inks clear 4.5:1 on their
 * own 15% wash over the page (known-deviations D34), not over a card that is itself tinted: on a
 * my-schedule clash card (`bg-danger/10`, `bg-warning/10`) the two washes stacked and "Attending"
 * read 3.93:1. The base makes the chip's background the same on every card.
 */
export function WorkshopRoleChip({ role }: { role: 'teaching' | 'attending' }): ReactNode {
  const { t } = useI18n();
  const teaching = role === 'teaching';
  return (
    <span className="shrink-0 rounded-full bg-background">
      <span
        className={`block rounded-full px-2 py-0.5 text-[11px] font-bold ${
          teaching ? 'bg-instructor/15 text-instructor' : 'bg-success/15 text-success'
        }`}
      >
        {teaching
          ? t('publicApp.me.events.roleInstructor')
          : t('publicApp.me.events.roleParticipant')}
      </span>
    </span>
  );
}
