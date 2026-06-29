'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

/**
 * Sync poll cadence after clicking "Sync now". The BullMQ worker writes a
 * fresh row to `hema_ratings_snapshots` only at the very end of a
 * successful run, so we poll the fighters endpoint until the latest
 * `syncedAt` advances past the value we captured before enqueueing.
 *
 * 5 s × 72 ticks = 6 minutes — well past the worker's worst-case runtime
 * (one fetch to hemaratings.com + one per linked fighter), so a timeout
 * here means the job actually failed or was retried out, in which case
 * we tell the user the table will pick up the next snapshot on a fresh
 * page load.
 */
const SYNC_POLL_INTERVAL_MS = 5_000;
const SYNC_POLL_TIMEOUT_MS = 6 * 60 * 1_000;

interface RatingRow {
  weapon: string;
  category: string;
  rank: number | null;
  weightedRating: number;
  lastCompeted: string | null;
}

interface TrackedFighter {
  globalPersonId: string;
  slug: string | null;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  clubName: string | null;
  photoUrl: string | null;
  hemaRatingsId: string;
  syncedAt: string | null;
  ratings: RatingRow[];
  lastCompeted: string | null;
  profileMissing: boolean;
}

interface SyncHistoryEntry {
  id: string;
  syncedAt: string;
  fighterCount: number;
}

interface HealthResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export default function HemaRatingsAdminPage() {
  const { t } = useI18n();
  const [fighters, setFighters] = useState<TrackedFighter[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ globalPersonId: string; value: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [history, setHistory] = useState<SyncHistoryEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSyncPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const loadFighters = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hema-ratings/fighters`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TrackedFighter[];
      setFighters(data);
      return data;
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : t('admin.common.loadTrackedFightersFailed'),
      );
      setFighters([]);
      return [];
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; state set after await, not synchronously
    void loadFighters();
  }, [loadFighters]);

  useEffect(() => stopSyncPolling, [stopSyncPolling]);

  const latestSyncedAt = useMemo(() => fighters?.[0]?.syncedAt ?? null, [fighters]);

  const filtered = useMemo(() => {
    if (!fighters) return [];
    const q = search.trim().toLowerCase();
    if (!q) return fighters;
    return fighters.filter((f) => {
      const haystack = `${f.displayName} ${f.clubName ?? ''} ${f.hemaRatingsId}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [fighters, search]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function handleRunSync() {
    if (syncing) return;
    // Snapshot the pre-sync timestamp so the polling loop can detect
    // when the worker has written a new row to hema_ratings_snapshots.
    const preSyncedAt = fighters?.[0]?.syncedAt ?? null;
    stopSyncPolling();
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hema-ratings/sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      // 202 — job enqueued. Switch to "waiting" message and start polling
      // the fighters endpoint until syncedAt advances past preSyncedAt or
      // the safety timeout fires.
      await res.json().catch(() => null);
      setSyncMessage(t('admin.hemaRatings.syncWaiting'));

      pollIntervalRef.current = setInterval(() => {
        void (async () => {
          const next = await loadFighters();
          const nextSyncedAt = next?.[0]?.syncedAt ?? null;
          if (nextSyncedAt && nextSyncedAt !== preSyncedAt) {
            stopSyncPolling();
            setSyncing(false);
            setSyncMessage(t('admin.hemaRatings.syncCompleted'));
          }
        })();
      }, SYNC_POLL_INTERVAL_MS);

      pollTimeoutRef.current = setTimeout(() => {
        stopSyncPolling();
        setSyncing(false);
        setSyncMessage(t('admin.hemaRatings.syncTimeout'));
      }, SYNC_POLL_TIMEOUT_MS);
    } catch (err) {
      stopSyncPolling();
      setSyncing(false);
      setSyncMessage(err instanceof Error ? err.message : t('admin.hemaRatings.syncFailed'));
    }
  }

  async function handleRefreshOne(globalPersonId: string) {
    setRefreshing((prev) => new Set(prev).add(globalPersonId));
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hema-ratings/fighters/${globalPersonId}/refresh`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      // Re-load the whole list so the row picks up the new ratings.
      await loadFighters();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : t('admin.hemaRatings.refreshFailed'));
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(globalPersonId);
        return next;
      });
    }
  }

  async function handleHealthCheck() {
    if (checkingHealth) return;
    setCheckingHealth(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hema-ratings/health`, {
        credentials: 'include',
      });
      const body = (await res.json()) as HealthResult;
      setHealth(body);
    } catch {
      setHealth({ ok: false, status: null, latencyMs: 0, error: t('admin.common.networkError') });
    } finally {
      setCheckingHealth(false);
    }
  }

  async function handleOpenHistory() {
    setHistoryOpen(true);
    if (history) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hema-ratings/sync-history?limit=10`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SyncHistoryEntry[];
      setHistory(body);
    } catch {
      setHistory([]);
    }
  }

  async function handleSaveEdit(globalPersonId: string, newValue: string) {
    const trimmed = newValue.trim();
    // Validate — HEMA Ratings IDs are short numeric strings. Empty string =
    // clear tracking.
    if (trimmed && !/^\d+$/.test(trimmed)) {
      setSyncMessage(t('admin.hemaRatings.invalidRatingId'));
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/fighters/${globalPersonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hemaRatingsId: trimmed || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setEditing(null);
      await loadFighters();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : t('admin.hemaRatings.saveFailed'));
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header strip */}
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          {t('admin.shell.sectionPlatformHealth')}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-foreground">
              {t('admin.hemaRatings.title')}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t('admin.hemaRatings.subtitle', {
                relative: formatRelative(latestSyncedAt),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRunSync()}
              disabled={syncing}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {syncing ? t('admin.hemaRatings.runSyncRunning') : t('admin.hemaRatings.runSyncNow')}
            </button>
            <button
              type="button"
              onClick={() => void handleHealthCheck()}
              disabled={checkingHealth}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
            >
              {checkingHealth ? '…' : t('admin.hemaRatings.healthCheck')}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenHistory()}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
            >
              {t('admin.hemaRatings.syncHistory')}
            </button>
          </div>
        </div>
        {syncMessage && (
          <p className="mt-3 inline-block rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
            {syncMessage}
          </p>
        )}
        {health && (
          <p className="mt-3 inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-mono">
            <span
              className={health.ok ? 'text-success' : 'text-danger'}
              aria-label={health.ok ? 'ok' : 'failed'}
            >
              ●
            </span>{' '}
            {t('admin.adminMisc.hemaHealthLine', {
              status: health.status ?? 'ERR',
              latency: health.latencyMs,
            })}
            {health.error ? ` · ${health.error}` : ''}
          </p>
        )}
      </header>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.hemaRatings.searchPlaceholder')}
          className="w-full max-w-md rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {loadError}
        </div>
      )}

      {/* Table */}
      {fighters === null ? (
        <p className="text-sm text-muted">{t('admin.hemaRatings.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-muted">
            {fighters.length === 0
              ? t('admin.hemaRatings.emptyState')
              : t('admin.hemaRatings.noMatch')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-background text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="w-1/4 px-3 py-2">{t('admin.hemaRatings.colName')}</th>
                <th className="w-1/6 px-3 py-2">{t('admin.hemaRatings.colClub')}</th>
                <th className="w-1/6 px-3 py-2">{t('admin.hemaRatings.colRatingId')}</th>
                <th className="px-3 py-2">{t('admin.hemaRatings.colWeapons')}</th>
                <th className="w-24 px-3 py-2">{t('admin.hemaRatings.colLastCompeted')}</th>
                <th className="w-20 px-3 py-2 text-right">{t('admin.hemaRatings.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((f) => {
                const isExpanded = expanded.has(f.globalPersonId);
                const isRefreshing = refreshing.has(f.globalPersonId);
                const isEditing = editing?.globalPersonId === f.globalPersonId;
                return (
                  <>
                    <tr key={f.globalPersonId} className="hover:bg-background">
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          onClick={() => toggleExpanded(f.globalPersonId)}
                          className="text-muted hover:text-foreground-secondary"
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium text-foreground">{f.displayName}</p>
                        {f.profileMissing && (
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-warning">
                            {t('admin.hemaRatings.profileMissing')}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-foreground-secondary">
                        {f.clubName ?? '—'}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editing!.value}
                              onChange={(e) =>
                                setEditing({
                                  globalPersonId: f.globalPersonId,
                                  value: e.target.value,
                                })
                              }
                              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on the inline edit input when a row enters edit mode
                              autoFocus
                              className="w-20 rounded border border-border px-2 py-1 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveEdit(f.globalPersonId, editing!.value)}
                              className="text-xs font-semibold text-success hover:text-success/80"
                            >
                              {t('admin.hemaRatings.save')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="text-xs text-muted hover:text-foreground-secondary"
                            >
                              {t('admin.hemaRatings.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                globalPersonId: f.globalPersonId,
                                value: f.hemaRatingsId,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 font-mono text-xs text-foreground-secondary hover:bg-border"
                          >
                            {f.hemaRatingsId}
                            <span className="text-muted">✎</span>
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {f.ratings.length === 0 ? (
                            <span className="text-xs italic text-muted">
                              {t('admin.hemaRatings.noRatings')}
                            </span>
                          ) : (
                            f.ratings.map((r) => (
                              <span
                                key={`${r.weapon}-${r.category}`}
                                className="inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 text-[11px] text-foreground-secondary"
                                title={`${r.weapon} · ${r.category}`}
                              >
                                {r.weapon}
                                {r.rank !== null && <span className="text-muted">#{r.rank}</span>}
                                <span className="font-mono">{r.weightedRating.toFixed(1)}</span>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-xs text-muted">
                        {formatDate(f.lastCompeted)}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <button
                          type="button"
                          onClick={() => void handleRefreshOne(f.globalPersonId)}
                          disabled={isRefreshing}
                          aria-label={t('admin.hemaRatings.refreshFighter')}
                          title={t('admin.hemaRatings.refreshFighter')}
                          className="rounded p-1 text-muted hover:bg-background hover:text-foreground-secondary disabled:cursor-wait disabled:opacity-50"
                        >
                          {isRefreshing ? '…' : '↻'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${f.globalPersonId}-detail`} className="bg-background/60">
                        <td></td>
                        <td colSpan={6} className="px-3 py-3">
                          {f.ratings.length === 0 ? (
                            <p className="text-xs italic text-muted">
                              {t('admin.hemaRatings.detailEmpty')}
                            </p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
                                <tr>
                                  <th className="py-1">{t('admin.hemaRatings.detailWeapon')}</th>
                                  <th className="py-1">{t('admin.hemaRatings.detailCategory')}</th>
                                  <th className="py-1 text-center">
                                    {t('admin.hemaRatings.detailRank')}
                                  </th>
                                  <th className="py-1 text-center">
                                    {t('admin.hemaRatings.detailWeightedRating')}
                                  </th>
                                  <th className="py-1 text-right">
                                    {t('admin.hemaRatings.detailLastCompeted')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.ratings.map((r) => (
                                  <tr key={`${r.weapon}-${r.category}`}>
                                    <td className="py-1 font-medium text-foreground">{r.weapon}</td>
                                    <td className="py-1 text-foreground-secondary">{r.category}</td>
                                    <td className="py-1 text-center font-mono tabular-nums text-foreground-secondary">
                                      {r.rank ?? '—'}
                                    </td>
                                    <td className="py-1 text-center font-mono tabular-nums text-foreground">
                                      {r.weightedRating.toFixed(1)}
                                    </td>
                                    <td className="py-1 text-right font-mono text-muted">
                                      {formatDate(r.lastCompeted)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sync history drawer */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.hemaRatings.syncHistoryTitle')}
        >
          <button
            type="button"
            aria-label={t('admin.adminMisc.close')}
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-display font-semibold text-lg sm:text-xl">
                {t('admin.hemaRatings.syncHistoryTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="text-sm text-muted hover:text-foreground-secondary"
              >
                {t('admin.hemaRatings.close')}
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
              {history === null ? (
                <p className="text-muted">{t('admin.hemaRatings.loading')}</p>
              ) : history.length === 0 ? (
                <p className="text-muted">{t('admin.hemaRatings.syncHistoryEmpty')}</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-baseline justify-between rounded-md border border-border px-3 py-2"
                    >
                      <span className="font-mono text-xs text-foreground-secondary">
                        {new Date(row.syncedAt).toLocaleString()}
                      </span>
                      <span className="text-xs text-muted">
                        {row.fighterCount.toLocaleString()} {t('admin.hemaRatings.fightersLabel')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
