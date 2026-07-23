'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useLiveBoard } from './useLiveBoard';
import { deriveHealthState, sortBoardRows, type HealthState } from './live-board-state';
import type { BoardRow, MatchChange } from './types';

type T = ReturnType<typeof useI18n>['t'];

// One channel per lice (stable set). `matches` is scoped by lice_id (no
// event_id column), so we subscribe per lice and patch that lice's current
// match. Renders nothing — it is a subscription, not UI.
function LiceRealtime({
  liceId,
  onChange,
  onDrop,
}: {
  liceId: string;
  onChange: (c: MatchChange) => void;
  onDrop: () => void;
}) {
  useRealtimeWithFallback({
    channelName: `live-board-lice:${liceId}`,
    table: 'matches',
    filter: `lice_id=eq.${liceId}`,
    event: 'UPDATE',
    onEvent: ({ new: n }) => {
      if (!n) return;
      onChange({
        id: n['id'] as string,
        redScore: n['red_score'] as number,
        blueScore: n['blue_score'] as number,
        status: n['status'] as string,
      });
    },
    onFallbackPoll: onDrop, // socket down → force a structural refetch
    fallbackPollMs: 7000,
  });
  return null;
}

const DOT: Record<HealthState, string> = {
  attention: 'bg-danger',
  stuck: 'bg-danger',
  stale: 'bg-warning',
  synced: 'bg-success',
  idle: 'bg-muted',
  unknown: 'bg-muted',
  no_scorer: 'bg-foreground',
};

export function LiveBoard({ slug, eventId }: { slug: string; eventId: string }) {
  const { t } = useI18n();
  const { rows, error, refetch, acknowledge, applyMatchChange } = useLiveBoard(eventId);
  const [mode, setMode] = useState<'piste' | 'worst'>('piste');

  if (error === 'forbidden')
    return <p className="p-6 text-muted">{t('organizer.live.forbidden')}</p>;
  if (!rows) return <p className="p-6 text-muted">{t('common.loading')}</p>;

  const sorted = sortBoardRows(rows, mode);
  const attentionCount = rows.filter((r) => r.attention).length;

  return (
    <div className="p-4">
      {/* per-lice realtime subscribers (render nothing) */}
      {rows.map((r) => (
        <LiceRealtime
          key={r.lice.id}
          liceId={r.lice.id}
          onChange={applyMatchChange}
          onDrop={() => void refetch()}
        />
      ))}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {t('organizer.live.summary', { pistes: rows.length, attention: attentionCount })}
        </p>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode('piste')}
            className={mode === 'piste' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortPiste')}
          </button>
          <button
            type="button"
            onClick={() => setMode('worst')}
            className={mode === 'worst' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortWorst')}
          </button>
        </div>
      </div>
      {error === 'refresh' && (
        <p className="mb-2 text-xs text-warning">{t('organizer.live.staleRefresh')}</p>
      )}

      <ul className="divide-y divide-border">
        {sorted.map((row) => (
          <BoardRowView
            key={row.lice.id}
            row={row}
            slug={slug}
            eventId={eventId}
            onAck={(id) => void acknowledge(id)}
            t={t}
          />
        ))}
      </ul>
    </div>
  );
}

function BoardRowView({
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
    <li className={`flex items-center gap-3 py-2 text-sm ${dim}`}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`} aria-label={state} />
      <Link
        href={`/org/${slug}/events/${eventId}/schedule`}
        className="w-16 shrink-0 font-semibold text-foreground hover:underline"
      >
        {row.lice.name}
      </Link>
      {cm ? (
        <Link
          href={`/org/${slug}/events/${eventId}/matches/${cm.id}`}
          className="flex-1 truncate text-foreground hover:underline"
        >
          {`${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`}
        </Link>
      ) : (
        <span className="flex-1 truncate text-muted">{t('organizer.live.idle')}</span>
      )}
      <span className="w-24 shrink-0 text-muted">
        {cm ? `${cm.round ? `R${cm.round} · ` : ''}${cm.status}` : ''}
      </span>
      <span className="w-28 shrink-0 truncate text-muted">
        {row.scorer ? (
          <Link href={`/org/${slug}/events/${eventId}/staff`} className="hover:underline">
            {row.scorer.name}
          </Link>
        ) : (
          t('organizer.live.noScorer')
        )}
      </span>
      <span className="w-24 shrink-0 text-muted">
        {row.health === null
          ? t('organizer.live.unknown')
          : row.health.rejectedCount > 0
            ? `✖ ${row.health.outboxDepth}q·${row.health.rejectedCount}r`
            : row.health.outboxDepth > 0
              ? `▲ ${row.health.outboxDepth}q`
              : t('organizer.live.synced')}
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
      <span className="w-20 shrink-0 text-right text-muted">
        {row.nextUp ? (
          <Link
            href={`/org/${slug}/events/${eventId}/schedule`}
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
