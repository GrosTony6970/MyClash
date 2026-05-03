'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  created_at: string;
}

interface AuditLogResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface AuditFilters {
  actor: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
}

const emptyFilters: AuditFilters = {
  actor: '',
  action: '',
  entityType: '',
  from: '',
  to: '',
};

function appendFilter(params: URLSearchParams, key: keyof AuditFilters, value: string) {
  const trimmed = value.trim();
  if (trimmed) params.set(key, trimmed);
}

function buildParams(filters: AuditFilters, page?: number, perPage?: number): string {
  const params = new URLSearchParams();
  appendFilter(params, 'actor', filters.actor);
  appendFilter(params, 'action', filters.action);
  appendFilter(params, 'entityType', filters.entityType);
  appendFilter(params, 'from', filters.from);
  appendFilter(params, 'to', filters.to);
  if (page) params.set('page', String(page));
  if (perPage) params.set('perPage', String(perPage));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function payloadPreview(payload: unknown): string {
  if (payload === null || payload === undefined) return '-';
  return JSON.stringify(payload);
}

export default function AdminAuditLogPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [draftFilters, setDraftFilters] = useState<AuditFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(emptyFilters);
  const [response, setResponse] = useState<AuditLogResponse>({
    items: [],
    total: 0,
    page: 1,
    perPage: 50,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(
    () => buildParams(appliedFilters, page, perPage),
    [appliedFilters, page, perPage],
  );
  const exportHref = useMemo(
    () => `${apiUrl}/api/v1/admin/audit-log/export.csv${buildParams(appliedFilters)}`,
    [apiUrl, appliedFilters],
  );

  const updateDraft = useCallback((key: keyof AuditFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/audit-log${queryString}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError('Access denied. Super admin required.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to load audit log');
        const data = (await res.json()) as AuditLogResponse;
        if (!cancelled) {
          setResponse(data);
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
  }, [apiUrl, queryString]);

  function applyFilters() {
    setLoading(true);
    setPage(1);
    setAppliedFilters(draftFilters);
  }

  function clearFilters() {
    setLoading(true);
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-gray-500 text-sm mt-1">
            Filter platform moderation, merge, and recovery actions.
          </p>
        </div>
        <a
          href={exportHref}
          className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Export CSV
        </a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="border border-gray-200 rounded-lg p-4 mb-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px_150px_150px]">
          <input
            value={draftFilters.actor}
            onChange={(event) => updateDraft('actor', event.target.value)}
            placeholder="Actor user ID"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            value={draftFilters.action}
            onChange={(event) => updateDraft('action', event.target.value)}
            placeholder="Action"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            value={draftFilters.entityType}
            onChange={(event) => updateDraft('entityType', event.target.value)}
            placeholder="Entity type"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            type="date"
            value={draftFilters.from}
            onChange={(event) => updateDraft('from', event.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            type="date"
            value={draftFilters.to}
            onChange={(event) => updateDraft('to', event.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={applyFilters}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-md text-sm"
          >
            Apply filters
          </button>
          <button
            onClick={clearFilters}
            className="border border-gray-300 hover:bg-gray-50 py-2 px-4 rounded-md text-sm"
          >
            Clear
          </button>
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
            Rows
            <select
              value={perPage}
              onChange={(event) => {
                setLoading(true);
                setPerPage(Number(event.target.value));
                setPage(1);
              }}
              className="border border-gray-300 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between text-sm text-gray-500">
        <span>
          {loading
            ? 'Loading...'
            : `${response.total} entries · page ${response.page} of ${response.totalPages}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={loading || response.page <= 1}
            className="border border-gray-300 rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <button
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.min(response.totalPages, current + 1));
            }}
            disabled={loading || response.page >= response.totalPages}
            className="border border-gray-300 rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>

      {response.items.length === 0 && !loading ? (
        <p className="text-gray-400 text-sm">No audit log entries match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {response.items.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                    {new Date(entry.created_at).toLocaleString('fr-FR')}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                    {entry.actor_user_id ?? '-'}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                      {entry.action}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <p className="font-medium">{entry.entity_type}</p>
                    <p className="font-mono text-xs text-gray-500">{entry.entity_id}</p>
                  </td>
                  <td className="py-2">
                    <pre className="max-w-xl whitespace-pre-wrap break-words text-xs text-gray-600">
                      {payloadPreview(entry.payload_json)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
