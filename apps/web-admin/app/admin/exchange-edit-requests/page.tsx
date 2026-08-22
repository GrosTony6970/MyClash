'use client';

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  Modal,
  RowActionButton,
} from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { PayloadCell, type PayloadLabel } from '../../../src/components/PayloadCell';
import { getPublicApiUrl } from '@/lib/api-url';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all';

interface ExchangeEditRequest {
  id: string;
  event_id: string;
  match_id: string;
  exchange_id: string;
  requested_by_user_id: string;
  requesterName: string | null;
  requesterEmail: string | null;
  request_type: 'void_exchange' | 'revert_void_exchange';
  reason: string;
  status: Exclude<RequestStatus, 'all'>;
  requested_payload: unknown;
  /** RFC 6901 JSON Pointer into requested_payload → label for the id there. */
  payloadLabels?: Record<string, PayloadLabel>;
  /** Backend-resolved labels for the event/match/exchange triple. */
  eventLabel: string | null;
  matchLabel: string | null;
  exchangeLabel: string | null;
  reviewed_by_user_id: string | null;
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

function typeLabel(type: ExchangeEditRequest['request_type']) {
  return type === 'void_exchange' ? 'Void exchange' : 'Restore exchange';
}

/** Human label when the record resolved, raw id (in mono) only as a fallback. */
function IdentifiedRow({ label, id }: { label: string | null; id: string }) {
  if (label) {
    return (
      <p className="truncate text-foreground-secondary" title={id}>
        {label}
      </p>
    );
  }
  return <p className="truncate font-mono text-muted">{id}</p>;
}

export default function ExchangeEditRequestsPage() {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [items, setItems] = useState<ExchangeEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<ExchangeEditRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // A path, not a URL: the seam takes the base separately.
  const endpoint = useMemo(() => `/api/v1/admin/exchange-edit-requests?status=${status}`, [status]);

  const refresh = useCallback(() => {
    setLoading(true);
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void apiRequest<ExchangeEditRequest[]>(apiUrl, endpoint, {
      signal: controller.signal,
    }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setItems(r.data);
        setError(null);
        setLoading(false);
        return;
      }
      // The platform-role ruling — see admin/backups and the review queue.
      if (r.kind === 'unauthenticated') {
        setError(t('admin.common.accessDeniedSuperAdmin'));
        setLoading(false);
        return;
      }
      const message = failureMessage(r, t, t('admin.common.loadExchangeEditRequestsFailed'));
      if (message) {
        setError(message);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, endpoint, refreshKey, t]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/exchange-edit-requests/${id}/approve`, {
        method: 'POST',
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.approvalFailed'));
        if (message) setError(message);
        return;
      }
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    setError(null);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/exchange-edit-requests/${rejectTarget.id}/reject`,
        { method: 'POST', body: { reason: rejectReason.trim() } },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.rejectionFailed'));
        if (message) setError(message);
        return;
      }
      setRejectTarget(null);
      setRejectReason('');
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.adminDesignReq.frozenResultsTitle')}
          </h1>
          <p className="text-muted text-sm mt-1">
            {t('admin.adminDesignReq.frozenResultsSubtitle')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground-secondary">
          {t('admin.adminDesignReq.statusFilterLabel')}
          <select
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value as RequestStatus);
            }}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="pending">{t('admin.adminDesignReq.filterPending')}</option>
            <option value="approved">{t('admin.adminDesignReq.filterApproved')}</option>
            <option value="rejected">{t('admin.adminDesignReq.filterRejected')}</option>
            <option value="all">{t('admin.adminDesignReq.filterAll')}</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="mb-3 text-sm text-muted">
        {loading ? 'Loading...' : `${items.length} requests`}
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-muted text-sm">{t('admin.adminDesignReq.emptyState')}</p>
      ) : (
        <DataTable className="min-w-[1180px]">
          <DataTableHead>
            <DataTableCell as="th">{t('admin.adminDesignReq.colCreated')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colRequest')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colRequester')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colEventMatchExchange')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colReason')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colReview')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminDesignReq.colPayload')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {items.map((request) => (
              <DataTableRow key={request.id}>
                <DataTableCell className="whitespace-nowrap text-foreground-secondary">
                  {new Date(request.created_at).toLocaleString(localeToBcp47(locale))}
                </DataTableCell>
                <DataTableCell>
                  <p className="font-semibold text-foreground">{typeLabel(request.request_type)}</p>
                  <span className="mt-1 inline-block rounded bg-background px-2 py-1 font-mono text-xs">
                    {request.status}
                  </span>
                </DataTableCell>
                <DataTableCell className="text-xs text-foreground-secondary">
                  <p className="font-medium">
                    {request.requesterName ??
                      request.requesterEmail ??
                      t('admin.common.unknownUser')}
                  </p>
                  {request.requesterName && request.requesterEmail && (
                    <p className="font-mono text-muted">{request.requesterEmail}</p>
                  )}
                </DataTableCell>
                <DataTableCell className="text-xs">
                  {/* Label first, raw id only in the tooltip — this cell used to
                      stack three bare UUIDs, which reads as broken UI. */}
                  <IdentifiedRow label={request.eventLabel} id={request.event_id} />
                  <IdentifiedRow label={request.matchLabel} id={request.match_id} />
                  <IdentifiedRow label={request.exchangeLabel} id={request.exchange_id} />
                </DataTableCell>
                <DataTableCell className="max-w-xs text-foreground-secondary">
                  {request.reason}
                </DataTableCell>
                <DataTableCell>
                  {request.status === 'pending' ? (
                    <div className="flex gap-2">
                      <RowActionButton
                        variant="success"
                        onClick={() => void approve(request.id)}
                        disabled={busyId === request.id}
                      >
                        {t('admin.adminDesignReq.approve')}
                      </RowActionButton>
                      <RowActionButton
                        variant="danger"
                        onClick={() => {
                          setRejectTarget(request);
                          setRejectReason('');
                        }}
                        disabled={busyId === request.id}
                      >
                        {t('admin.adminDesignReq.reject')}
                      </RowActionButton>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">
                      <p>
                        {request.reviewed_at
                          ? new Date(request.reviewed_at).toLocaleString(localeToBcp47(locale))
                          : '-'}
                      </p>
                      <p>
                        {request.reviewedByName ??
                          request.reviewedByEmail ??
                          (request.reviewed_by_user_id ? t('admin.common.unknownUser') : '-')}
                      </p>
                      {request.rejection_reason && (
                        <p className="mt-1">{request.rejection_reason}</p>
                      )}
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <PayloadCell
                    payload={request.requested_payload}
                    labels={request.payloadLabels ?? {}}
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      {rejectTarget && (
        <Modal
          open
          onClose={() => setRejectTarget(null)}
          busy={busyId === rejectTarget.id}
          size="md"
          title={t('admin.adminDesignReq.rejectModalTitle')}
          description={typeLabel(rejectTarget.request_type)}
          footer={
            <>
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-sm text-muted hover:text-foreground-secondary"
              >
                {t('admin.adminDesignReq.cancel')}
              </button>
              <button
                onClick={() => void reject()}
                disabled={busyId === rejectTarget.id || !rejectReason.trim()}
                className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger-hover disabled:opacity-50"
              >
                {t('admin.adminDesignReq.rejectConfirm')}
              </button>
            </>
          }
        >
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={4}
            placeholder={t('admin.adminDesignReq.rejectReasonPlaceholder')}
            className="mt-4 w-full resize-none rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Modal>
      )}
    </main>
  );
}
