'use client';
import { formatTime } from '@myclash/time';
import { useI18n } from '@/i18n/I18nProvider';
import type { HealthState } from '@/lib/live-board/live-board-state';
import { projectedFinishMs } from '@/lib/live-board/live-board-timing';
import type { BoardRow, LiveBoardProgress } from '@/lib/live-board/types';

type T = ReturnType<typeof useI18n>['t'];

/**
 * The strip above the board: what is running, what is behind, how much of the
 * day is left, and when it is likely to end.
 *
 * v1 showed "N pistes · N need attention", which answered neither of the two
 * questions an organizer actually asks between bouts — am I behind, and how
 * much is left.
 */
interface StatsProps {
  rows: BoardRow[];
  stateOf: (row: BoardRow) => HealthState;
  attention: number;
  progress: LiveBoardProgress | null;
  nowMs: number;
  matchDurationMinutes: number;
  t: T;
}

interface SummaryProps extends StatsProps {
  mode: 'piste' | 'worst';
  onModeChange: (mode: 'piste' | 'worst') => void;
  stale: boolean;
}

export function BoardSummary({ mode, onModeChange, stale, ...stats }: SummaryProps) {
  const { t } = stats;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SummaryStats {...stats} />
        <div className="flex shrink-0 gap-2 text-sm">
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

/** The at-a-glance numbers: what is running, what is behind, what is left. */
function SummaryStats({
  rows,
  stateOf,
  attention,
  progress,
  nowMs,
  matchDurationMinutes,
  t,
}: StatsProps) {
  const { locale } = useI18n();
  const states = rows.map(stateOf);
  const running = rows.filter((r) => r.currentMatch?.startedAt).length;
  const idle = states.filter((s) => s === 'idle' || s === 'idle_stalled').length;
  const behind = states.filter((s) => s === 'late' || s === 'idle_stalled').length;

  const remaining = progress ? Math.max(0, progress.total - progress.completed) : 0;
  // Projected off pistes actually RUNNING, not off pistes that exist: an event
  // with ten pistes and two scorers finishes at the pace of two.
  const finishMs = projectedFinishMs(nowMs, remaining, running, matchDurationMinutes);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span>{t('organizer.live.summary', { pistes: rows.length, attention })}</span>
      <span>{t('organizer.live.counts', { running, idle })}</span>
      {behind > 0 && (
        <span className="text-warning">{t('organizer.live.behind', { count: behind })}</span>
      )}
      {progress && progress.total > 0 && (
        <span>
          {t('organizer.live.progress', { done: progress.completed, total: progress.total })}
        </span>
      )}
      {finishMs !== null && (
        <span>
          {t('organizer.live.projectedFinish', {
            time: formatTime(new Date(finishMs).toISOString(), locale),
          })}
        </span>
      )}
    </div>
  );
}
