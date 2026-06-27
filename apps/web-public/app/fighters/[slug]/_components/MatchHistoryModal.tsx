'use client';

import { useEffect, useRef, useState } from 'react';
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
  const backdropRef = useRef<HTMLDivElement>(null);

  const fetchPage = async (currentOffset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const url = `${apiUrl}/api/v1/fighters/${slug}/matches?limit=${PAGE_SIZE}&offset=${currentOffset}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { items: MatchSummary[]; total: number };
      setTotal(data.total);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    await fetchPage(nextOffset, true);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === backdropRef.current) onClose();
  };

  const hasMore = items.length < total;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-gray-950 shadow-2xl"
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            {t('publicApp.fighterProfile.matchHistoryTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:text-white"
            aria-label="Close"
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
