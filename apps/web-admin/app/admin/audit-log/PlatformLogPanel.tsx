'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { type PlatformFilters, type PlatformLogEntry, emptyFilters } from './platform-entry';
import { PlatformEntryPanel } from './PlatformEntryPanel';
import { PlatformLogFilters } from './PlatformLogFilters';
import { PlatformLogTable } from './PlatformLogTable';
import { useEntrySelection } from './use-entry-selection';

interface PlatformLogResponse {
  items: PlatformLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  truncated: boolean;
}

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
  const { t } = useI18n();
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
  /** A refused Resolve, kept with its entry: the side panel shows it on that entry only. */
  const [resolveFailure, setResolveFailure] = useState<{ id: string; message: string } | null>(
    null,
  );
  /** Bumped after a resolve so the feed refetches without a full remount. */
  const [reloadToken, setReloadToken] = useState(0);
  const selection = useEntrySelection(response.items);

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
   * collide across the nine sources — the endpoint wants the bare uuid. The list
   * then reloads, and `loading` holds Resolve until it lands: the side panel's
   * Resolve cannot be sent twice (ruling 911).
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
          if (message) setResolveFailure({ id: entryId, message });
          return;
        }
        setResolveFailure(null);
        setLoading(true);
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

      <PlatformLogFilters
        draft={draftFilters}
        onDraft={updateDraft}
        onApply={applyFilters}
        onClear={clearFilters}
        perPage={perPage}
        onPerPage={(next) => {
          setLoading(true);
          setPerPage(next);
          setPage(1);
        }}
      />

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
        <PlatformLogTable
          items={response.items}
          selectedId={selection.entry?.id ?? null}
          onOpen={selection.open}
          resolving={resolving}
          onResolve={(id) => void resolveEntry(id)}
        />
      )}
      <PlatformEntryPanel
        selection={selection}
        busy={resolving !== null || loading}
        error={
          resolveFailure?.id === selection.entry?.id ? (resolveFailure?.message ?? null) : null
        }
        onResolve={(id) => void resolveEntry(id)}
      />
    </>
  );
}
