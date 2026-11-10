'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * The "Present" box of one line of the instructor's roster (operator rulings 539-545). Drawn only
 * for a seat or a waiting-list place (`canTick`): a refused person has none (541). Absent `onTick`
 * (a cancelled session's roster, 526), it shows its state and takes no tap.
 */
export function RosterTick({
  name,
  checkedInAt,
  busy,
  onTick,
}: {
  name: string;
  checkedInAt: string | null | undefined;
  busy: boolean;
  onTick?: (present: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <input
        type="checkbox"
        aria-label={t('publicApp.me.instructor.presentFor', { name })}
        checked={Boolean(checkedInAt)}
        disabled={!onTick || busy}
        onChange={(e) => onTick?.(e.target.checked)}
        className="h-4 w-4 rounded accent-success disabled:opacity-50"
      />
      {t('publicApp.me.instructor.present')}
    </label>
  );
}
