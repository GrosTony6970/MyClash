'use client';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { DOT } from '@/lib/live-board/live-board-state';
import type { HealthState } from '@/lib/live-board/live-board-state';
import { timingReadout } from '@/lib/live-board/board-timing-labels';
import { matchStatusLabel } from '@/lib/live-board/match-status';
import type { BoardRow } from '@/lib/live-board/types';

type T = ReturnType<typeof useI18n>['t'];

// Mobile (< md): one stacked card per piste. The wide desktop row
// (BoardRowView) is unusable on a phone — this variant stacks the piste
// header, the score line, and a wrapping meta row (status · scorer · health)
// so a card never forces horizontal scroll.
export function BoardCard({
  row,
  state,
  nowMs,
  matchDurationMinutes,
  slug,
  eventId,
  onAck,
  t,
}: {
  row: BoardRow;
  state: HealthState;
  nowMs: number;
  matchDurationMinutes: number;
  slug: string;
  eventId: string;
  onAck: (id: string) => void;
  t: T;
}) {
  const { locale } = useI18n();
  const cm = row.currentMatch;
  const timing = timingReadout(row, nowMs, matchDurationMinutes, locale, t);
  return (
    <li
      className="flex flex-col gap-1.5 py-3"
      data-testid="live-row"
      data-lice-name={row.lice.name}
    >
      <div className="flex items-center gap-2">
        <span
          role="img"
          className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`}
          aria-label={t(`organizer.live.state.${state}`)}
        />
        <Link
          href={`/org/${slug}/events/${eventId}/schedule`}
          className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline"
          title={row.lice.name}
        >
          {row.lice.name}
        </Link>
        {row.nextUp && (
          <Link
            href={`/org/${slug}/events/${eventId}/matches/${row.nextUp.matchId}`}
            className="shrink-0 text-xs text-muted hover:underline"
            title={t('organizer.live.nextLabel')}
          >
            {t('organizer.live.nextLabel')} · {row.nextUp.label}
          </Link>
        )}
      </div>
      {cm ? (
        <Link
          href={`/org/${slug}/events/${eventId}/matches/${cm.id}`}
          className="truncate text-foreground hover:underline"
        >
          {`${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`}
        </Link>
      ) : (
        <span className="text-muted">{t('organizer.live.state.idle')}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {cm && (
          <span>{`${cm.round ? `R${cm.round} · ` : ''}${matchStatusLabel(cm.status, t)}`}</span>
        )}
        {timing.clock && <span className="tabular-nums text-foreground">{timing.clock}</span>}
        {timing.behind && (
          <span className={timing.warn ? 'text-warning' : undefined}>{timing.behind}</span>
        )}
        <span className="min-w-0 truncate">
          {row.scorer ? (
            <Link href={`/org/${slug}/events/${eventId}/staff`} className="hover:underline">
              {row.scorer.name}
            </Link>
          ) : (
            t('organizer.live.state.no_scorer')
          )}
        </span>
        <span>
          {row.health === null
            ? t('organizer.live.unknown')
            : row.health.rejectedCount > 0
              ? `✖ ${row.health.outboxDepth}q·${row.health.rejectedCount}r`
              : row.health.outboxDepth > 0
                ? `▲ ${row.health.outboxDepth}q`
                : t('organizer.live.state.synced')}
        </span>
      </div>
      {row.attention && row.scorer && (
        <button
          type="button"
          onClick={() => onAck(row.scorer!.accountId)}
          className="self-start rounded-md bg-danger/10 px-2 py-1 text-xs text-danger"
        >
          {t(`organizer.live.reason.${row.attention.reason}`)} · {t('organizer.live.ack')}
        </button>
      )}
    </li>
  );
}
