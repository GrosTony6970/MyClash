'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { localeToBcp47 } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { QueryErrorDetail } from './QueryErrorDetail';

type PlatformLogCategory =
  | 'ai_scan'
  | 'ai_finding'
  | 'broadcast_failure'
  | 'club_review'
  | 'ai_usage'
  | 'ai_draft'
  | 'deletion'
  | 'merge'
  | 'club_archive'
  | 'query_error';

type PlatformLogSeverity = 'info' | 'warning' | 'error';

interface PlatformLogEntry {
  id: string;
  category: PlatformLogCategory;
  severity: PlatformLogSeverity;
  occurredAt: string;
  title: string | null;
  detail: string | null;
  /** Raw actor id — used only to distinguish unresolved-user from no-user; never rendered. */
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  href: string | null;
  /** Aggregated sources only (query_error today) — a count, formatted here. */
  occurrenceCount?: number;
  firstSeenAt?: string;
  resolvable?: boolean;
}

interface PlatformLogResponse {
  items: PlatformLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  truncated: boolean;
}

interface PlatformFilters {
  category: string;
  severity: string;
  from: string;
  to: string;
}

const emptyFilters: PlatformFilters = { category: '', severity: '', from: '', to: '' };

const CATEGORIES: PlatformLogCategory[] = [
  'ai_scan',
  'ai_finding',
  'broadcast_failure',
  'club_review',
  'ai_usage',
  'ai_draft',
  'deletion',
  'merge',
  'club_archive',
];

const SEVERITIES: PlatformLogSeverity[] = ['info', 'warning', 'error'];

const SEVERITY_PILL: Record<PlatformLogSeverity, string> = {
  error: 'bg-danger/10 text-danger border border-danger/30',
  warning: 'bg-gold/10 text-gold-text',
  info: 'bg-background text-foreground-secondary',
};

function appendFilter(params: URLSearchParams, key: keyof PlatformFilters, value: string) {
  const trimmed = value.trim();
  if (trimmed) params.set(key, trimmed);
}

function buildParams(filters: PlatformFilters, page?: number, perPage?: number): string {
  const params = new URLSearchParams();
  appendFilter(params, 'category', filters.category);
  appendFilter(params, 'severity', filters.severity);
  appendFilter(params, 'from', filters.from);
  appendFilter(params, 'to', filters.to);
  if (page) params.set('page', String(page));
  if (perPage) params.set('perPage', String(perPage));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function PlatformLogPanel() {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();

  const [draftFilters, setDraftFilters] = useState<PlatformFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<PlatformFilters>(emptyFilters);
  const [response, setResponse] = useState<PlatformLogResponse>({
    items: [],
    total: 0,
    page: 1,
    perPage: 50,
    totalPages: 1,
    truncated: false,
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  /** Bumped after a resolve so the feed refetches without a full remount. */
  const [reloadToken, setReloadToken] = useState(0);

  const queryString = useMemo(
    () => buildParams(appliedFilters, page, perPage),
    [appliedFilters, page, perPage],
  );

  const updateDraft = useCallback((key: keyof PlatformFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }, []);

  /**
   * Silence one tripped query.
   *
   * `entry.id` is source-prefixed (`query_error:<uuid>`) so React keys never
   * collide across the nine sources — the endpoint wants the bare uuid.
   */
  const resolveEntry = useCallback(
    async (entryId: string) => {
      const id = entryId.slice(entryId.indexOf(':') + 1);
      setResolving(entryId);
      try {
        const r = await apiRequest(apiUrl, `/api/v1/admin/query-errors/${id}/resolve`, {
          method: 'PATCH',
        });
        if (!r.ok) {
          const message = failureMessage(r, t, t('admin.platformLog.resolveError'));
          if (message) setError(message);
          return;
        }
        setReloadToken((n) => n + 1);
      } finally {
        setResolving(null);
      }
    },
    [apiUrl, t],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void apiRequest<PlatformLogResponse>(apiUrl, `/api/v1/admin/platform-log${queryString}`, {
      signal: controller.signal,
    }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setResponse(r.data);
        setError(null);
        setLoading(false);
        return;
      }
      // The platform-role ruling — see AuditLogPanel next door.
      if (r.kind === 'unauthenticated') {
        setError(t('admin.platformLog.accessDenied'));
        setLoading(false);
        return;
      }
      const message = failureMessage(r, t, t('admin.platformLog.loadError'));
      if (message) {
        setError(message);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, queryString, t, reloadToken]);

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
      <p className="text-muted text-sm mb-6">{t('admin.platformLog.subtitle')}</p>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="border border-border rounded-lg p-4 mb-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px]">
          <select
            value={draftFilters.category}
            onChange={(event) => updateDraft('category', event.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">{t('admin.platformLog.filters.categoryAll')}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`admin.platformLog.category.${category}`)}
              </option>
            ))}
          </select>
          <select
            value={draftFilters.severity}
            onChange={(event) => updateDraft('severity', event.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">{t('admin.platformLog.filters.severityAll')}</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {t(`admin.platformLog.severity.${severity}`)}
              </option>
            ))}
          </select>
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
            {t('admin.platformLog.filters.applyButton')}
          </button>
          <button
            onClick={clearFilters}
            className="border border-border hover:bg-background py-2 px-4 rounded-md text-sm"
          >
            {t('admin.platformLog.filters.clearButton')}
          </button>
          <label className="ml-auto flex items-center gap-2 text-sm text-foreground-secondary">
            {t('admin.platformLog.filters.rowsLabel')}
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

      {response.truncated && !loading && (
        <div className="bg-gold/10 text-gold-text rounded-md px-4 py-2 mb-4 text-sm">
          {t('admin.platformLog.truncatedNotice')}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>
          {loading
            ? t('admin.platformLog.pagination.loading')
            : t('admin.platformLog.pagination.summary', {
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
            {t('admin.platformLog.pagination.previous')}
          </button>
          <button
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.min(response.totalPages, current + 1));
            }}
            disabled={loading || response.page >= response.totalPages}
            className="border border-border rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-background"
          >
            {t('admin.platformLog.pagination.next')}
          </button>
        </div>
      </div>

      {response.items.length === 0 && !loading ? (
        <p className="text-muted text-sm">{t('admin.platformLog.empty')}</p>
      ) : (
        <DataTable className="min-w-[1000px]">
          <DataTableHead>
            <DataTableCell as="th">{t('admin.platformLog.columns.occurred')}</DataTableCell>
            <DataTableCell as="th">{t('admin.platformLog.columns.category')}</DataTableCell>
            <DataTableCell as="th">{t('admin.platformLog.columns.severity')}</DataTableCell>
            <DataTableCell as="th">{t('admin.platformLog.columns.event')}</DataTableCell>
            <DataTableCell as="th">{t('admin.platformLog.columns.detail')}</DataTableCell>
            <DataTableCell as="th">{t('admin.platformLog.columns.actor')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {response.items.map((entry) => {
              const eventLabel = entry.title ?? t(`admin.platformLog.category.${entry.category}`);
              return (
                <DataTableRow key={entry.id}>
                  <DataTableCell className="whitespace-nowrap text-foreground-secondary">
                    {new Date(entry.occurredAt).toLocaleString(localeToBcp47(locale))}
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap text-foreground-secondary">
                    {t(`admin.platformLog.category.${entry.category}`)}
                  </DataTableCell>
                  <DataTableCell>
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-medium ${SEVERITY_PILL[entry.severity]}`}
                    >
                      {t(`admin.platformLog.severity.${entry.severity}`)}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    {entry.href ? (
                      <Link href={entry.href} className="font-medium text-accent hover:underline">
                        {eventLabel}
                      </Link>
                    ) : (
                      <span className="font-medium">{eventLabel}</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    <pre className="max-w-xl whitespace-pre-wrap break-words text-xs text-foreground-secondary">
                      {entry.detail ?? '—'}
                    </pre>
                    <QueryErrorDetail
                      occurrenceCount={entry.occurrenceCount}
                      firstSeenAt={entry.firstSeenAt}
                      resolvable={entry.resolvable}
                      resolving={resolving === entry.id}
                      onResolve={() => void resolveEntry(entry.id)}
                      locale={locale}
                      t={t}
                    />
                  </DataTableCell>
                  <DataTableCell className="text-xs text-foreground-secondary">
                    {entry.actorUserId ? (
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
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
