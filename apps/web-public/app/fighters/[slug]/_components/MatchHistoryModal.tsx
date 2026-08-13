'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

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

  const handleLoadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    await loadMore(nextOffset);
  };

  const hasMore = items.length < total;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('publicApp.fighterProfile.matchHistoryTitle')}
      footer={
        <button
          onClick={onClose}
          className="rounded p-1 text-muted transition-colors hover:text-foreground"
          aria-label={t('actions.close')}
        >
          ✕
        </button>
      }
    >
      {loading ? (
        <p className="p-6 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">
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
                className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{match.opponentName || '—'}</p>
                  <p className="text-xs text-muted">
                    {match.eventName || match.tournamentName}
                    {match.weapon ? ` · ${match.weapon}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-xs font-bold',
                      won
                        ? 'bg-success/15 text-success'
                        : draw
                          ? 'bg-warning/15 text-warning'
                          : 'bg-danger/15 text-danger',
                    ].join(' ')}
                  >
                    {won ? 'W' : draw ? 'D' : 'L'}
                  </span>
                  <p className="font-mono text-sm font-bold tabular-nums text-foreground">
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
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground-secondary transition-colors hover:border-muted hover:text-foreground disabled:opacity-50"
            >
              {loadingMore
                ? t('common.loading')
                : t('publicApp.fighterProfile.matchHistoryLoadMore')}
            </button>
          ) : items.length > 0 ? (
            <p className="text-xs text-muted">{t('publicApp.fighterProfile.matchHistoryNoMore')}</p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
