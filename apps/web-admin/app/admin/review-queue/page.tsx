'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';
import type { ReviewQueueItem } from './_types';
import { QueueRow } from './_components/QueueRow';
import { ApproveModal } from './_components/ApproveModal';
import { RejectModal } from './_components/RejectModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabValue = 'all' | 'deletion' | 'exchange_edit' | 'club_review' | 'ruleset_submission';
type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

interface Tab {
  value: TabValue;
  label: string;
}

const TABS: Tab[] = [
  { value: 'all', label: t('admin.reviewQueue.tabAll') },
  { value: 'deletion', label: t('admin.reviewQueue.tabDeletions') },
  { value: 'exchange_edit', label: t('admin.reviewQueue.tabExchangeEdits') },
  { value: 'club_review', label: t('admin.reviewQueue.tabClubReviews') },
  { value: 'ruleset_submission', label: t('admin.reviewQueue.tabRulesetSubmissions') },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: t('admin.reviewQueue.statusPending') },
  { value: 'approved', label: t('admin.reviewQueue.statusApproved') },
  { value: 'rejected', label: t('admin.reviewQueue.statusRejected') },
  { value: 'all', label: t('admin.reviewQueue.statusAll') },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReviewQueuePage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const toast = useToast();

  // ── State ────────────────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [pendingItems, setPendingItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [approveTarget, setApproveTarget] = useState<ReviewQueueItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ReviewQueueItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Build endpoint ───────────────────────────────────────────────────────────

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (activeTab !== 'all') params.set('type', activeTab);
    if (statusFilter !== 'pending') params.set('status', statusFilter);
    const qs = params.toString();
    return `${apiUrl}/api/v1/admin/review-queue${qs ? `?${qs}` : ''}`;
  }, [apiUrl, activeTab, statusFilter]);

  const pendingEndpoint = useMemo(() => `${apiUrl}/api/v1/admin/review-queue`, [apiUrl]);

  // ── Fetch main list ──────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    fetch(endpoint, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError('Access denied. Super admin required.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to load review queue');
        const data = (await res.json()) as ReviewQueueItem[];
        if (!cancelled) {
          setItems(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint, refreshKey]);

  // ── Fetch pending counts (all types, pending only) ───────────────────────────

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(pendingEndpoint, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReviewQueueItem[];
        if (!cancelled) setPendingItems(data);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pendingEndpoint, refreshKey]);

  // ── Pending counts per tab ───────────────────────────────────────────────────

  const pendingCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: pendingItems.length,
      deletion: 0,
      exchange_edit: 0,
      club_review: 0,
      ruleset_submission: 0,
    };
    for (const item of pendingItems) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [pendingItems]);

  const totalPending = pendingCounts['all'] ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{t('admin.reviewQueue.pageTitle')}</h1>
        {totalPending > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
            {t('admin.reviewQueue.pendingBadge', { count: totalPending })}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mb-1 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const count = pendingCounts[tab.value] ?? 0;
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => {
                setActiveTab(tab.value);
                setLoading(true);
              }}
              className={[
                'flex items-center gap-1.5 rounded-t border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-red-700 text-red-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {tab.label}
              {count > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status filter sub-bar */}
      <div className="mb-5 flex flex-wrap gap-1 bg-slate-50 border border-slate-200 rounded-md p-1 w-fit">
        {STATUS_FILTERS.map((sf) => {
          const isActive = statusFilter === sf.value;
          return (
            <button
              key={sf.value}
              onClick={() => {
                setStatusFilter(sf.value);
                setLoading(true);
              }}
              className={[
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {sf.label}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Count */}
      <div className="mb-3 text-sm text-slate-500">
        {loading ? 'Loading…' : `${items.length} item${items.length !== 1 ? 's' : ''}`}
      </div>

      {/* Table */}
      {!loading && items.length === 0 ? (
        <p className="text-slate-400 text-sm">{t('admin.reviewQueue.noPending')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colType')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colTarget')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colRequester')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colAge')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colReason')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.reviewQueue.colStatus')}</th>
                <th className="py-2 font-medium">{t('admin.reviewQueue.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <QueueRow
                  key={`${item.type}-${item.id}`}
                  item={item}
                  busyId={busyId}
                  onApprove={(it) => setApproveTarget(it)}
                  onReject={(it) => setRejectTarget(it)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve modal */}
      {approveTarget && (
        <ApproveModal
          item={approveTarget}
          apiUrl={apiUrl}
          onClose={() => setApproveTarget(null)}
          onApproved={() => {
            setApproveTarget(null);
            toast.success(t('admin.reviewQueue.actionSucceeded'));
            setBusyId(null);
            refresh();
          }}
        />
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          item={rejectTarget}
          apiUrl={apiUrl}
          onClose={() => setRejectTarget(null)}
          onRejected={() => {
            setRejectTarget(null);
            toast.success(t('admin.reviewQueue.actionSucceeded'));
            setBusyId(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
