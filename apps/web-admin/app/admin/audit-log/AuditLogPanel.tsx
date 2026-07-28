'use client';

import { localeToBcp47 } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { PayloadCell, type PayloadLabel } from '../../../src/components/PayloadCell';
import { getPublicApiUrl } from '@/lib/api-url';

interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  /** Backend-resolved actor display name / email. Null when unresolved. */
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  created_at: string;
  /** Backend-resolved human label per entity_type. Null when the
   *  underlying record was hard-deleted or the type isn't in the
   *  resolver switch — the FE still shows the raw UUID below. */
  entityLabel?: string | null;
  /** RFC 6901 JSON Pointer into payload_json → label for the id at that spot.
   *  Absent pointers just mean "render the raw value". */
  payloadLabels?: Record<string, PayloadLabel>;
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

export function AuditLogPanel() {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();

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
          setError(t('admin.auditLog.accessDenied'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.auditLog.loadError'));
        const data = (await res.json()) as AuditLogResponse;
        if (!cancelled) {
          setResponse(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.auditLog.genericError'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, queryString, t]);

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
    <>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <p className="text-muted text-sm">{t('admin.auditLog.subtitle')}</p>
        <a
          href={exportHref}
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background"
        >
          {t('admin.auditLog.exportCsv')}
        </a>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="border border-border rounded-lg p-4 mb-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px_150px_150px]">
          <input
            value={draftFilters.actor}
            onChange={(event) => updateDraft('actor', event.target.value)}
            placeholder={t('admin.auditLog.filters.actorPlaceholder')}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            value={draftFilters.action}
            onChange={(event) => updateDraft('action', event.target.value)}
            placeholder={t('admin.auditLog.filters.actionPlaceholder')}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            value={draftFilters.entityType}
            onChange={(event) => updateDraft('entityType', event.target.value)}
            placeholder={t('admin.auditLog.filters.entityTypePlaceholder')}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            type="date"
            value={draftFilters.from}
            onChange={(event) => updateDraft('from', event.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            type="date"
            value={draftFilters.to}
            onChange={(event) => updateDraft('to', event.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={applyFilters}
            className="bg-accent hover:bg-accent-hover text-white font-semibold py-2 px-4 rounded-md text-sm"
          >
            {t('admin.auditLog.filters.applyButton')}
          </button>
          <button
            onClick={clearFilters}
            className="border border-border hover:bg-background py-2 px-4 rounded-md text-sm"
          >
            {t('admin.auditLog.filters.clearButton')}
          </button>
          <label className="ml-auto flex items-center gap-2 text-sm text-foreground-secondary">
            {t('admin.auditLog.filters.rowsLabel')}
            <select
              value={perPage}
              onChange={(event) => {
                setLoading(true);
                setPerPage(Number(event.target.value));
                setPage(1);
              }}
              className="border border-border rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>
          {loading
            ? t('admin.auditLog.pagination.loading')
            : t('admin.auditLog.pagination.summary', {
                total: response.total,
                page: response.page,
                totalPages: response.totalPages,
              })}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={loading || response.page <= 1}
            className="border border-border rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-background"
          >
            {t('admin.auditLog.pagination.previous')}
          </button>
          <button
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.min(response.totalPages, current + 1));
            }}
            disabled={loading || response.page >= response.totalPages}
            className="border border-border rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-background"
          >
            {t('admin.auditLog.pagination.next')}
          </button>
        </div>
      </div>

      {response.items.length === 0 && !loading ? (
        <p className="text-muted text-sm">{t('admin.auditLog.empty')}</p>
      ) : (
        <DataTable className="min-w-[1100px]">
          <DataTableHead>
            <DataTableCell as="th">{t('admin.auditLog.columns.created')}</DataTableCell>
            <DataTableCell as="th">{t('admin.auditLog.columns.actor')}</DataTableCell>
            <DataTableCell as="th">{t('admin.auditLog.columns.action')}</DataTableCell>
            <DataTableCell as="th">{t('admin.auditLog.columns.entity')}</DataTableCell>
            <DataTableCell as="th">{t('admin.auditLog.columns.payload')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {response.items.map((entry) => (
              <DataTableRow key={entry.id}>
                <DataTableCell className="whitespace-nowrap text-foreground-secondary">
                  {new Date(entry.created_at).toLocaleString(localeToBcp47(locale))}
                </DataTableCell>
                <DataTableCell className="text-xs text-foreground-secondary">
                  {entry.actor_user_id ? (
                    <p className="font-medium">
                      {entry.actorName ?? entry.actorEmail ?? t('admin.common.unknownUser')}
                    </p>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {entry.actorName && entry.actorEmail && (
                    <p className="font-mono text-muted">{entry.actorEmail}</p>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <span className="rounded bg-background px-2 py-1 font-mono text-xs">
                    {entry.action}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <p className="font-medium">{entry.entity_type}</p>
                  {entry.entityLabel && (
                    <p className="text-sm text-foreground-secondary">{entry.entityLabel}</p>
                  )}
                  <p
                    className="font-mono text-xs text-muted max-w-[220px] truncate"
                    title={entry.entity_id ?? ''}
                  >
                    {entry.entity_id}
                  </p>
                </DataTableCell>
                <DataTableCell>
                  <PayloadCell payload={entry.payload_json} labels={entry.payloadLabels ?? {}} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
