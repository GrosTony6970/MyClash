'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface MatchSummary {
  id: string;
  matchScheduledAt: string | null;
  eventId: string;
  eventName: string;
  eventDate: string;
  tournamentId: string;
  tournamentName: string;
  weapon: string;
  opponentName: string;
  ourScore: number;
  opponentScore: number;
  outcome: 'win' | 'loss' | 'draw';
  status: string;
}

interface Props {
  slug: string;
  apiUrl: string;
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function MatchHistoryModal({ slug, apiUrl, onClose }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<MatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Append the next page. The initial load lives in the effect below; this is
  // only ever the "Load more" path, so it always appends + drives loadingMore.
  const loadMore = async (currentOffset: number) => {
    setLoadingMore(true);
    try {
      const url = `${apiUrl}/api/v1/fighters/${slug}/matches?limit=${PAGE_SIZE}&offset=${currentOffset}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { items: MatchSummary[]; total: number };
      setTotal(data.total);
      setItems((prev) => [...prev, ...data.items]);
    } finally {
      setLoadingMore(false);
    }
  };

  // Initial load. `loading` starts true, so we don't setState synchronously in
  // the effect body (which trips set-state-in-effect) — the spinner shows from
  // the initial state and we flip it off only after the fetch resolves.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/fighters/${slug}/matches?limit=${PAGE_SIZE}&offset=0`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items: MatchSummary[]; total: number };
        setTotal(data.total);
        setItems(data.items);
      } catch {
        // ignore (incl. AbortError on unmount / slug change)
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [slug, apiUrl]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleLoadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    await loadMore(nextOffset);
  };

  const hasMore = items.length < total;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      {/* Pointer-only click-outside-to-close. A real <button> (so it's not a
          non-interactive element with a click handler), but hidden from the
          tab order + AT — keyboard/SR users close via Escape or the header ✕,
          so it doesn't duplicate the "Close" control. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-history-title"
        className="relative z-10 flex w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-gray-950 shadow-2xl"
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2
            id="match-history-title"
            className="text-xs font-semibold uppercase tracking-wider text-amber-400"
          >
            {t('publicApp.fighterProfile.matchHistoryTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:text-white"
            aria-label={t('actions.close')}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-gray-400">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">
              {t('publicApp.fighterProfile.matchHistoryEmpty')}
            </p>
          ) : (
            <div className="flex flex-col gap-2 p-4">
              {items.map((match) => {
                const won = match.outcome === 'win';
                const draw = match.outcome === 'draw';
                return (
                  <div
                    key={match.id}
                    className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{match.opponentName || '—'}</p>
                      <p className="text-xs text-gray-500">
                        {match.eventName || match.tournamentName}
                        {match.weapon ? ` · ${match.weapon}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-bold',
                          won
                            ? 'bg-green-900 text-green-300'
                            : draw
                              ? 'bg-yellow-900 text-yellow-300'
                              : 'bg-red-900/50 text-red-400',
                        ].join(' ')}
                      >
                        {won ? 'W' : draw ? 'D' : 'L'}
                      </span>
                      <p className="font-mono text-sm font-bold tabular-nums text-white">
                        {match.ourScore}-{match.opponentScore}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && (
            <div className="px-4 pb-4 text-center">
              {hasMore ? (
                <button
                  onClick={() => void handleLoadMore()}
                  disabled={loadingMore}
                  className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-50"
                >
                  {loadingMore
                    ? t('common.loading')
                    : t('publicApp.fighterProfile.matchHistoryLoadMore')}
                </button>
              ) : items.length > 0 ? (
                <p className="text-xs text-gray-600">
                  {t('publicApp.fighterProfile.matchHistoryNoMore')}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
