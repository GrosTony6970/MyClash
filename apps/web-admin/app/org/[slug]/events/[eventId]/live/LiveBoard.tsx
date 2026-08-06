'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useLiveBoard } from './useLiveBoard';
import { partitionByHealth, sortBoardRows } from './live-board-state';
import { BoardRowView } from './BoardRowView';
import { BoardCard } from './BoardCard';
import { BoardSummary } from './BoardSummary';
import type { MatchChange } from './types';

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
  const { rows, error, acknowledge, applyMatchChange } = useLiveBoard(eventId);
  const [mode, setMode] = useState<'piste' | 'worst'>('piste');
  const [showHealthy, setShowHealthy] = useState(false);

  if (error === 'forbidden')
    return <p className="p-6 text-muted">{t('organizer.live.forbidden')}</p>;
  if (!rows) return <p className="p-6 text-muted">{t('common.loading')}</p>;

  const sorted = sortBoardRows(rows, mode);
  const { problems, healthy } = partitionByHealth(sorted);
  const attentionCount = rows.filter((r) => r.attention).length;

  return (
    <div className="p-4">
      {/* per-lice realtime subscribers (render nothing) */}
      {rows.map((r) => (
        <LiceRealtime key={r.lice.id} liceId={r.lice.id} onChange={applyMatchChange} />
      ))}

      <BoardSummary
        pistes={rows.length}
        attention={attentionCount}
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
