'use client';
import type { useI18n } from '@/i18n/I18nProvider';

type T = ReturnType<typeof useI18n>['t'];

// The strip above the board: how many pistes, how many need attention, the
// sort toggle, and the "couldn't refresh" note. Split out of LiveBoard so the
// board component stays a layout shell over the two row renderers.
export function BoardSummary({
  pistes,
  attention,
  mode,
  onModeChange,
  stale,
  t,
}: {
  pistes: number;
  attention: number;
  mode: 'piste' | 'worst';
  onModeChange: (mode: 'piste' | 'worst') => void;
  stale: boolean;
  t: T;
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{t('organizer.live.summary', { pistes, attention })}</p>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => onModeChange('piste')}
            className={mode === 'piste' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortPiste')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('worst')}
            className={mode === 'worst' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortWorst')}
          </button>
        </div>
      </div>
      {stale && <p className="mb-2 text-xs text-warning">{t('organizer.live.staleRefresh')}</p>}
    </>
  );
}
