'use client';
import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { DOT, isHealthy } from './live-board-state';
import type { HealthState } from './live-board-state';
import { timingReadout } from './board-timing-labels';
import { matchStatusLabel } from './match-status';
import type { BoardRow } from './types';

type T = ReturnType<typeof useI18n>['t'];

// Desktop (>= md): one wide row per piste, rendered as an <li> inside the
// board's <ul>. Column widths are fixed so every row's cells line up as a
// table would, without the markup cost of one.
export function BoardRowView({
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
  /** Derived once per tick by the board, so every surface agrees on the instant. */
  state: HealthState;
  nowMs: number;
  matchDurationMinutes: number;
  slug: string;
  eventId: string;
  onAck: (id: string) => void;
  t: T;
}) {
  const { locale } = useI18n();
  const dim = isHealthy(state) ? 'opacity-60' : '';
  const cm = row.currentMatch;
  const timing = timingReadout(row, nowMs, matchDurationMinutes, locale, t);
  return (
    <li
      className={`flex items-center gap-3 py-2 text-sm ${dim}`}
      data-testid="live-row"
      data-lice-name={row.lice.name}
    >
      <span
        role="img"
        className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`}
        aria-label={t(`organizer.live.state.${state}`)}
      />
      <Link
        href={`/org/${slug}/events/${eventId}/schedule`}
        className="w-32 shrink-0 truncate font-semibold text-foreground hover:underline"
        title={row.lice.name}
      >
        {row.lice.name}
      </Link>
      {cm ? (
        <Link
          href={`/org/${slug}/events/${eventId}/matches/${cm.id}`}
          className="min-w-0 flex-1 truncate text-foreground hover:underline"
        >
          {`${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted">{t('organizer.live.state.idle')}</span>
      )}
      <span className="w-24 shrink-0 truncate text-muted">
        {cm ? `${cm.round ? `R${cm.round} · ` : ''}${matchStatusLabel(cm.status, t)}` : ''}
      </span>
      <span className="w-28 shrink-0 truncate tabular-nums">
        {timing.clock && <span className="text-foreground">{timing.clock}</span>}
        {timing.behind && (
          <span className={timing.warn ? 'text-warning' : 'text-muted'}>
            {timing.clock ? ' · ' : ''}
            {timing.behind}
          </span>
        )}
      </span>
      <span className="w-28 shrink-0 truncate text-muted">
        {row.scorer ? (
          <Link href={`/org/${slug}/events/${eventId}/staff`} className="hover:underline">
            {row.scorer.name}
          </Link>
        ) : (
          t('organizer.live.state.no_scorer')
        )}
      </span>
      <span className="w-24 shrink-0 text-muted">
        {row.health === null
          ? t('organizer.live.unknown')
          : row.health.rejectedCount > 0
            ? `✖ ${row.health.outboxDepth}q·${row.health.rejectedCount}r`
            : row.health.outboxDepth > 0
              ? `▲ ${row.health.outboxDepth}q`
              : t('organizer.live.state.synced')}
      </span>
      <span className="w-32 shrink-0">
        {row.attention && row.scorer ? (
          <button
            type="button"
            onClick={() => onAck(row.scorer!.accountId)}
            className="rounded-md bg-danger/10 px-2 py-1 text-danger"
          >
            {t(`organizer.live.reason.${row.attention.reason}`)} · {t('organizer.live.ack')}
          </button>
        ) : (
          '—'
        )}
      </span>
      <span className="w-20 shrink-0 truncate text-right text-muted">
        {row.nextUp ? (
          <Link
            href={`/org/${slug}/events/${eventId}/matches/${row.nextUp.matchId}`}
            className="hover:underline"
            title={t('organizer.live.nextLabel')}
          >
            {row.nextUp.label}
          </Link>
        ) : (
          '—'
        )}
      </span>
    </li>
  );
}
