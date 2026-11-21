import { formatMinuteSpan, type AppLocale } from '@myclash/time';
import { silentForSec, type HealthState } from './live-board-state';
import type { BoardRow } from './types';

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * The tablet's cell of a board row: what its last check-in said, or, once the
 * tablet has gone quiet (ruling 951), for how long nothing has come. One owner
 * for the row and the card.
 */
export function healthCellText(
  row: BoardRow,
  state: HealthState,
  serverNowMs: number,
  locale: AppLocale,
  t: T,
): string {
  const silent = silentForSec(row, serverNowMs);
  if ((state === 'no_news' || state === 'lost') && silent !== null) {
    return t('organizer.live.state.noNewsFor', {
      span: formatMinuteSpan(silent * 1000, locale),
    });
  }
  if (row.health === null) return t('organizer.live.unknown');
  if (row.health.rejectedCount > 0) {
    return t('organizer.live.state.queuedRefused', {
      queued: row.health.outboxDepth,
      refused: row.health.rejectedCount,
    });
  }
  if (row.health.outboxDepth > 0) {
    return t('organizer.live.state.queued', { queued: row.health.outboxDepth });
  }
  return t('organizer.live.state.synced');
}
