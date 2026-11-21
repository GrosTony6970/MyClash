import type { useI18n } from '@myclash/next-i18n/client';
import type { BoardRow } from '@/lib/live-board/types';

type T = ReturnType<typeof useI18n>['t'];

/**
 * Two tablets score one piste (ruling 953): a clock press of one can meet the
 * other's and go to Review. The board warns; it blocks nothing — a tablet that
 * broke is replaced by another. `compact` keeps the wide row's columns in line:
 * the count alone, the words in its label.
 */
export function TabletsWarning({ row, compact, t }: { row: BoardRow; compact: boolean; t: T }) {
  if (row.tablets < 2) return null;
  const words = t('organizer.live.tablets', { count: row.tablets });
  return (
    <span
      data-testid="tablets-warning"
      title={words}
      aria-label={words}
      className="relative z-10 shrink-0 rounded bg-warning/15 px-1.5 text-xs font-semibold text-warning"
    >
      ⚠ {compact ? row.tablets : words}
    </span>
  );
}
