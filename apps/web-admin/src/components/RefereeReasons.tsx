'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { RefereeReason } from '@myclash/rulesets/scheduling/referee-checker';
import { refereeReasonText } from '@/lib/referee-reasons';

/**
 * The reasons of one referee verdict (ADR-016), as every screen shows them: red when
 * Impossible, amber when Discouraged, grey and marked when the organiser already
 * confirmed over it (ruling 135). One owner, so the workspace, the schedule board and
 * the Pools page cannot word or colour the same verdict differently.
 */
export function RefereeReasons({ reasons }: { reasons: readonly RefereeReason[] }) {
  const { t } = useI18n();
  return (
    <span>
      {reasons.map((reason, i) => (
        <span key={`${reason.code}:${reason.against?.id ?? ''}`} className={toneOf(reason)}>
          {i > 0 && '; '}
          {refereeReasonText(t, reason.code, reason.against?.label ?? '')}
          {reason.confirmed && ` (${t('organizer.refereeBoard.confirmedOver')})`}
        </span>
      ))}
    </span>
  );
}

function toneOf(reason: RefereeReason): string {
  if (reason.confirmed) return 'text-muted';
  return reason.level === 'impossible' ? 'text-danger' : 'text-warning';
}
