'use client';
import Link from 'next/link';
import type { useI18n } from '@/i18n/I18nProvider';
import { deriveHealthState, DOT } from './live-board-state';
import { matchStatusLabel } from './match-status';
import type { BoardRow } from './types';

type T = ReturnType<typeof useI18n>['t'];

// Desktop (>= md): one wide row per piste, rendered as an <li> inside the
// board's <ul>. Column widths are fixed so every row's cells line up as a
// table would, without the markup cost of one.
export function BoardRowView({
  row,
  slug,
  eventId,
  onAck,
  t,
}: {
  row: BoardRow;
  slug: string;
  eventId: string;
  onAck: (id: string) => void;
  t: T;
}) {
  const state = deriveHealthState(row);
  const dim = state === 'synced' || state === 'idle' ? 'opacity-60' : '';
  const cm = row.currentMatch;
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
