'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, DataTableCell, DataTableHead, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';
import type { ReviewQueueItem } from './_types';
import { QueueRow } from './_components/QueueRow';
import { ApproveModal } from './_components/ApproveModal';
import { RejectModal } from './_components/RejectModal';
import { getPublicApiUrl } from '@/lib/api-url';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabValue =
  | 'all'
  | 'deletion'
  | 'exchange_edit'
  | 'club_review'
  | 'league_tournament_request'
  | 'league_membership_request';
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
  // Falls back to a hard-coded label if the i18n key isn't seeded yet; the
  // key is added below in en.json / fr.json (review-queue scope).
  {
    value: 'league_tournament_request',
    label: t('admin.reviewQueue.tabLeagueTournamentRequests') || 'League tournament requests',
  },
  {
    value: 'league_membership_request',
    label: t('admin.reviewQueue.tabLeagueMembershipRequests') || 'League join requests',
  },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: t('admin.reviewQueue.statusPending') },
  { value: 'approved', label: t('admin.reviewQueue.statusApproved') },
  { value: 'rejected', label: t('admin.reviewQueue.statusRejected') },
  { value: 'all', label: t('admin.reviewQueue.statusAll') },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReviewQueuePage() {
  const apiUrl = getPublicApiUrl();
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- toggling loading flag before the fetch this effect performs
    setLoading(true);

    fetch(endpoint, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.common.accessDeniedSuperAdmin'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.common.loadReviewQueueFailed'));
        const data = (await res.json()) as ReviewQueueItem[];
        if (!cancelled) {
          setItems(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.common.somethingWentWrong'));
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
    };
    for (const item of pendingItems) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [pendingItems]);

  const totalPending = pendingCounts['all'] ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('admin.reviewQueue.pageTitle')}
        </h1>
        {totalPending > 0 && (
          <span className="inline-flex items-center rounded-full bg-warning/10 px-3 py-1 text-sm font-semibold text-warning">
            {t('admin.reviewQueue.pendingBadge', { count: totalPending })}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mb-1 flex flex-wrap gap-1 border-b border-border">
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
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-foreground-secondary',
              ].join(' ')}
            >
              {tab.label}
              {count > 0 && (
                <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-xs font-bold text-warning">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status filter sub-bar */}
      <div className="mb-5 flex flex-wrap gap-1 bg-background border border-border rounded-md p-1 w-fit">
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
                  ? 'bg-surface text-foreground shadow-sm border border-border'
                  : 'text-muted hover:text-foreground-secondary',
              ].join(' ')}
            >
              {sf.label}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Count */}
      <div className="mb-3 text-sm text-muted">
        {loading ? 'Loading…' : `${items.length} item${items.length !== 1 ? 's' : ''}`}
      </div>

      {/* Table */}
      {!loading && items.length === 0 ? (
        <p className="text-muted text-sm">{t('admin.reviewQueue.noPending')}</p>
      ) : (
        <DataTable className="min-w-[900px]">
          <DataTableHead>
            <DataTableCell as="th">{t('admin.reviewQueue.colType')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colTarget')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colRequester')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colAge')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colReason')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colStatus')}</DataTableCell>
            <DataTableCell as="th">{t('admin.reviewQueue.colActions')}</DataTableCell>
          </DataTableHead>
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
        </DataTable>
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
