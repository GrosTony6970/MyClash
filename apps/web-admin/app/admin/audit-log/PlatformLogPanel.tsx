'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { localeToBcp47 } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

type PlatformLogCategory =
  | 'ai_scan'
  | 'ai_finding'
  | 'broadcast_failure'
  | 'club_review'
  | 'ai_usage'
  | 'ai_draft'
  | 'deletion'
  | 'merge'
  | 'club_archive';

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
  warning: 'bg-gold/10 text-gold',
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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

  const queryString = useMemo(
    () => buildParams(appliedFilters, page, perPage),
    [appliedFilters, page, perPage],
  );

  const updateDraft = useCallback((key: keyof PlatformFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/platform-log${queryString}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.platformLog.accessDenied'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.platformLog.loadError'));
        const data = (await res.json()) as PlatformLogResponse;
        if (!cancelled) {
          setResponse(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.platformLog.genericError'));
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
        <div className="bg-gold/10 text-gold rounded-md px-4 py-2 mb-4 text-sm">
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
