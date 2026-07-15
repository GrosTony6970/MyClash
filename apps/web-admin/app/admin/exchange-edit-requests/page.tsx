'use client';

import { RowActionButton } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

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

function payloadPreview(payload: unknown): string {
  if (!payload) return '-';
  return JSON.stringify(payload);
}

export default function ExchangeEditRequestsPage() {
  const { t, locale } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [items, setItems] = useState<ExchangeEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<ExchangeEditRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const endpoint = useMemo(
    () => `${apiUrl}/api/v1/admin/exchange-edit-requests?status=${status}`,
    [apiUrl, status],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(endpoint, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.common.accessDeniedSuperAdmin'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.common.loadExchangeEditRequestsFailed'));
        const data = (await res.json()) as ExchangeEditRequest[];
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
  }, [endpoint, refreshKey, t]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/exchange-edit-requests/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('admin.common.approvalFailed'));
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.approvalFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/exchange-edit-requests/${rejectTarget.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: rejectReason.trim() }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('admin.common.rejectionFailed'));
      }
      setRejectTarget(null);
      setRejectReason('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.rejectionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colCreated')}</th>
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colRequest')}</th>
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colRequester')}</th>
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colEventMatchExchange')}</th>
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colReason')}</th>
                <th className="py-2 pr-4">{t('admin.adminDesignReq.colReview')}</th>
                <th className="py-2">{t('admin.adminDesignReq.colPayload')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-border hover:bg-background align-top"
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-foreground-secondary">
                    {new Date(request.created_at).toLocaleString(localeToBcp47(locale))}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-foreground">
                      {typeLabel(request.request_type)}
                    </p>
                    <span className="mt-1 inline-block rounded bg-background px-2 py-1 font-mono text-xs">
                      {request.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-foreground-secondary">
                    <p className="font-medium">
                      {request.requesterName ??
                        request.requesterEmail ??
                        t('admin.common.unknownUser')}
                    </p>
                    {request.requesterName && request.requesterEmail && (
                      <p className="font-mono text-muted">{request.requesterEmail}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-muted">
                    <p>{request.event_id}</p>
                    <p>{request.match_id}</p>
                    <p>{request.exchange_id}</p>
                  </td>
                  <td className="py-3 pr-4 max-w-xs text-foreground-secondary">{request.reason}</td>
                  <td className="py-3 pr-4">
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
                  </td>
                  <td className="py-3">
                    <pre className="max-w-sm whitespace-pre-wrap break-words text-xs text-muted">
                      {payloadPreview(request.requested_payload)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
            <h2 className="font-display font-semibold text-lg sm:text-xl">
              {t('admin.adminDesignReq.rejectModalTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">{typeLabel(rejectTarget.request_type)}</p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              placeholder={t('admin.adminDesignReq.rejectReasonPlaceholder')}
              className="mt-4 w-full resize-none rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <div className="mt-4 flex justify-end gap-2">
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
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
