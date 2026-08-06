'use client';
import { useMemo, useState } from 'react';
import { useSecondsClock } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';
import { useLiveBoard } from '@/lib/live-board/useLiveBoard';
import {
  deriveHealthState,
  partitionByHealth,
  sortBoardRows,
} from '@/lib/live-board/live-board-state';
import type { HealthState } from '@/lib/live-board/live-board-state';
import { fallbackTiming } from '@/lib/live-board/live-board-timing';
import { BoardRowView } from './BoardRowView';
import { BoardCard } from './BoardCard';
import { BoardSummary } from './BoardSummary';
import type { BoardRow, MatchChange } from '@/lib/live-board/types';

// One channel per lice (stable set). `matches` is scoped by lice_id (no
// event_id column), so we subscribe per lice and patch that lice's current
// match. Renders nothing — it is a subscription, not UI.
function LiceRealtime({
  liceId,
  onChange,
}: {
  liceId: string;
  onChange: (c: MatchChange) => void;
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
    // useLiveBoard already runs the 7s structural poll; the per-lice channel
    // is a score-cell overlay only, so its socket-down fallback is a no-op.
    onFallbackPoll: () => {},
    fallbackPollMs: 7000,
  });
  return null;
}

export function LiveBoard({ slug, eventId }: { slug: string; eventId: string }) {
  const { t } = useI18n();
  const { rows, timing, progress, eventSlug, error, acknowledge, applyMatchChange } =
    useLiveBoard(eventId);
  const [mode, setMode] = useState<'piste' | 'worst'>('piste');
  const [showHealthy, setShowHealthy] = useState(false);
  // One row expanded at a time, keyed by BOTH lice and bout so the panel
  // auto-collapses on rollover with no effect and no flicker: the moment the
  // poll swaps that lice's currentMatch, `isExpanded` simply stops matching.
  // A useEffect calling setExpanded(null) would violate set-state-in-effect
  // AND paint one stale frame first.
  const [expanded, setExpanded] = useState<{ liceId: string; matchId: string | null } | null>(null);

  // Subscribed once, at the root. The elapsed readouts tick at 1 Hz, so a
  // per-row subscription would re-render every row's subtree on every tick for
  // a value the row is handed anyway.
  const { nowMs } = useSecondsClock(getPublicApiUrl());
  const clock = timing ?? fallbackTiming(nowMs);

  // One state per row per tick. deriveHealthState used to run three times per
  // row per render (sort, partition, row); this makes it once, and guarantees
  // the sort, the fold and the dot all agree on the same instant.
  const stateByLice = useMemo(() => {
    const map = new Map<string, HealthState>();
    for (const row of rows ?? []) {
      map.set(
        row.lice.id,
        deriveHealthState({
          row,
          nowMs,
          matchDurationMinutes: clock.matchDurationMinutes,
        }),
      );
    }
    return map;
  }, [rows, nowMs, clock.matchDurationMinutes]);

  const stateOf = (row: BoardRow): HealthState => stateByLice.get(row.lice.id) ?? 'unknown';
  const isExpanded = (row: BoardRow): boolean =>
    expanded?.liceId === row.lice.id && expanded.matchId === (row.currentMatch?.id ?? null);
  const toggle = (row: BoardRow) =>
    setExpanded((prev) =>
      prev?.liceId === row.lice.id
        ? null
        : { liceId: row.lice.id, matchId: row.currentMatch?.id ?? null },
    );

  if (error === 'forbidden')
    return <p className="p-6 text-muted">{t('organizer.live.forbidden')}</p>;
  if (!rows) return <p className="p-6 text-muted">{t('common.loading')}</p>;

  const sorted = sortBoardRows(rows, mode, stateOf);
  const { problems, healthy } = partitionByHealth(sorted, stateOf);
  const attentionCount = rows.filter((r) => r.attention).length;

  return (
    <div className="p-4">
      {/* per-lice realtime subscribers (render nothing) */}
      {rows.map((r) => (
        <LiceRealtime key={r.lice.id} liceId={r.lice.id} onChange={applyMatchChange} />
      ))}

      <BoardSummary
        rows={rows}
        stateOf={stateOf}
        attention={attentionCount}
        progress={progress}
        nowMs={nowMs}
        matchDurationMinutes={clock.matchDurationMinutes}
        mode={mode}
        onModeChange={setMode}
        stale={error === 'refresh'}
        t={t}
      />

      {/* Wide table: every piste, all breakpoints ≥ md */}
      <ul className="hidden divide-y divide-border md:block">
        {sorted.map((row) => (
          <BoardRowView
            key={row.lice.id}
            row={row}
            state={stateOf(row)}
            nowMs={nowMs}
            matchDurationMinutes={clock.matchDurationMinutes}
            expanded={isExpanded(row)}
            onToggle={() => toggle(row)}
            eventSlug={eventSlug}
            slug={slug}
            eventId={eventId}
            onAck={(id) => void acknowledge(id)}
            t={t}
          />
        ))}
      </ul>

      {/* Phone: problems first as stacked cards; healthy pistes folded away */}
      <div className="md:hidden">
        <ul className="divide-y divide-border">
          {problems.map((row) => (
            <BoardCard
              key={row.lice.id}
              row={row}
              state={stateOf(row)}
              nowMs={nowMs}
              matchDurationMinutes={clock.matchDurationMinutes}
              slug={slug}
              eventId={eventId}
              onAck={(id) => void acknowledge(id)}
              t={t}
            />
          ))}
        </ul>
        {healthy.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowHealthy((v) => !v)}
              aria-expanded={showHealthy}
              className="mt-2 flex w-full items-center gap-2 py-2 text-sm text-muted"
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-success" />
              {t('organizer.live.healthyFold', { count: healthy.length })}
              <span aria-hidden>{showHealthy ? '▾' : '▸'}</span>
            </button>
            {showHealthy && (
              <ul className="divide-y divide-border opacity-60">
                {healthy.map((row) => (
                  <BoardCard
                    key={row.lice.id}
                    row={row}
                    state={stateOf(row)}
                    nowMs={nowMs}
                    matchDurationMinutes={clock.matchDurationMinutes}
                    slug={slug}
                    eventId={eventId}
                    onAck={(id) => void acknowledge(id)}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
