'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all';

interface ExchangeEditRequest {
  id: string;
  event_id: string;
  match_id: string;
  exchange_id: string;
  requested_by_user_id: string;
  request_type: 'void_exchange' | 'revert_void_exchange';
  reason: string;
  status: Exclude<RequestStatus, 'all'>;
  requested_payload: unknown;
  reviewed_by_user_id: string | null;
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
          setError('Access denied. Super admin required.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to load exchange edit requests');
        const data = (await res.json()) as ExchangeEditRequest[];
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
        throw new Error(body.message ?? 'Approval failed');
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
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
        throw new Error(body.message ?? 'Rejection failed');
      }
      setRejectTarget(null);
      setRejectReason('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Frozen Results</h1>
          <p className="text-slate-500 text-sm mt-1">
            Review organizer correction requests for completed events.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Status
          <select
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value as RequestStatus);
            }}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="mb-3 text-sm text-slate-500">
        {loading ? 'Loading...' : `${items.length} requests`}
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-slate-400 text-sm">No exchange edit requests match this status.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Request</th>
                <th className="py-2 pr-4">Requester</th>
                <th className="py-2 pr-4">Event / match / exchange</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">Review</th>
                <th className="py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {items.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-slate-100 hover:bg-slate-50 align-top"
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                    {new Date(request.created_at).toLocaleString('fr-FR')}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-gray-950">{typeLabel(request.request_type)}</p>
                    <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 font-mono text-xs">
                      {request.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                    {request.requested_by_user_id}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                    <p>{request.event_id}</p>
                    <p>{request.match_id}</p>
                    <p>{request.exchange_id}</p>
                  </td>
                  <td className="py-3 pr-4 max-w-xs text-slate-700">{request.reason}</td>
                  <td className="py-3 pr-4">
                    {request.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void approve(request.id)}
                          disabled={busyId === request.id}
                          className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setRejectTarget(request);
                            setRejectReason('');
                          }}
                          disabled={busyId === request.id}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        <p>
                          {request.reviewed_at
                            ? new Date(request.reviewed_at).toLocaleString('fr-FR')
                            : '-'}
                        </p>
                        <p className="font-mono">{request.reviewed_by_user_id ?? '-'}</p>
                        {request.rejection_reason && (
                          <p className="mt-1">{request.rejection_reason}</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3">
                    <pre className="max-w-sm whitespace-pre-wrap break-words text-xs text-slate-500">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Reject correction request</h2>
            <p className="mt-1 text-sm text-slate-500">{typeLabel(rejectTarget.request_type)}</p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              placeholder="Reason shown to requester"
              className="mt-4 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void reject()}
                disabled={busyId === rejectTarget.id || !rejectReason.trim()}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
