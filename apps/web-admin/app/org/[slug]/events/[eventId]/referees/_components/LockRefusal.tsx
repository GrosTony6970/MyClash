'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { RefereeVerdictBanner } from '@/components/RefereeVerdictBanner';
import type { RefereeConflictEntry } from '@/lib/referee-reasons';

/**
 * The lock refused (ADR-019): locking tells every referee their duty, and these duties
 * break a rule with no override. The organiser reassigns them, or sends anyway.
 */
export function LockRefusal({
  conflicts,
  busy,
  onSend,
  onCancel,
}: {
  conflicts: RefereeConflictEntry[];
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className="space-y-2">
      <RefereeVerdictBanner conflicts={conflicts} />
      <p className="text-sm text-danger">{t('organizer.refereeBoard.lockRefused')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSend}
          className="rounded border border-danger px-2 py-0.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {t('organizer.refereeBoard.lockAnyway')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {t('organizer.refereeBoard.cancel')}
        </button>
      </div>
    </div>
  );
}
