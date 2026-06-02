'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BulkActionBar, ConfirmDialog, RowActionButton, useSelection, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface LeagueScoringSystemRow {
  id: string;
  code: string;
  name: string;
  is_builtin: boolean;
  is_archived: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

function pickPoints(map: Record<string, number>, rank: number): number | null {
  const v = map[String(rank)];
  return v === undefined ? null : v;
}

interface Props {
  readOnly?: boolean;
}

export function LeagueScoringSystemsTable({ readOnly = false }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const initialShowArchived = !readOnly && searchParams.get('showArchived') === 'true';
  const [showArchived, setShowArchived] = useState(initialShowArchived);

  const [rows, setRows] = useState<LeagueScoringSystemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<LeagueScoringSystemRow | null>(null);
  const [pendingBulkArchive, setPendingBulkArchive] = useState<LeagueScoringSystemRow[] | null>(
    null,
  );

  const selection = useSelection();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const qs = showArchived ? '?includeArchived=true' : '';
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems${qs}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.rulesets.league.loadError'));
      setRows((await res.json()) as LeagueScoringSystemRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.rulesets.league.loadError'));
    } finally {
      setLoading(false);
    }
  }, [showArchived, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function onToggleArchived(next: boolean) {
    setShowArchived(next);
    if (readOnly) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next) params.set('showArchived', 'true');
    else params.delete('showArchived');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?');
  }

  async function doClone(row: LeagueScoringSystemRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems/${row.id}/clone`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.league.cloneError'));
      }
      toast.success(t('admin.rulesets.league.toast.cloned', { name: row.name }));
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.rulesets.league.cloneError'));
    } finally {
      setBusyId(null);
    }
  }

  async function doRestore(row: LeagueScoringSystemRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems/${row.id}/restore`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.league.restoreError'));
      }
      toast.success(t('admin.rulesets.league.toast.restored', { name: row.name }));
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.rulesets.league.restoreError'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setBusyId(pendingArchive.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${pendingArchive.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.league.archiveError'));
      }
      toast.success(t('admin.rulesets.league.toast.archived', { name: pendingArchive.name }));
      setPendingArchive(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.rulesets.league.archiveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmBulkArchive() {
    if (!pendingBulkArchive) return;
    let archived = 0;
    let failed = 0;
    for (const row of pendingBulkArchive) {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems/${row.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          failed += 1;
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error(`${row.name}: ${body.message ?? t('admin.rulesets.league.archiveError')}`);
        } else {
          archived += 1;
        }
      } catch {
        failed += 1;
        toast.error(`${row.name}: ${t('admin.rulesets.league.archiveError')}`);
      }
    }
    toast.success(t('admin.rulesets.league.toast.bulkArchived', { n: archived, failed }));
    setPendingBulkArchive(null);
    selection.clear();
    await reload();
  }

  const archivableRows = useMemo(() => rows.filter((r) => !r.is_builtin && !r.is_archived), [rows]);
  const archivableIds = useMemo(() => archivableRows.map((r) => r.id), [archivableRows]);
  const selectedRows = useMemo(() => rows.filter((r) => selection.has(r.id)), [rows, selection]);

  const showActionsCol = !readOnly;
  const showCheckboxCol = !readOnly;
  const colCount = 6 + (showCheckboxCol ? 1 : 0) + (showActionsCol ? 1 : 0);

  return (
    <>
      {!readOnly && (
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/admin/rulesets/league/new"
            className="inline-flex items-center rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('admin.rulesets.league.newButton')}
          </Link>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              role="switch"
              aria-checked={showArchived}
              checked={showArchived}
              onChange={(e) => onToggleArchived(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-red-700 focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
            />
            {t('admin.rulesets.league.showArchivedToggle')}
          </label>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {showCheckboxCol && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t('admin.rulesets.league.bulk.selectAllAria')}
                    checked={
                      archivableIds.length > 0 && archivableIds.every((id) => selection.has(id))
                    }
                    onChange={() => selection.toggleAll(archivableIds)}
                    className="h-4 w-4 rounded border-slate-300 text-red-700 focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                  />
                </th>
              )}
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.code')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.name')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.points')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.tieBreakers')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.type')}</th>
              {showActionsCol && (
                <th className="px-4 py-3">{t('admin.rulesets.league.columns.actions')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-sm text-slate-400">
                  {t('admin.rulesets.league.loadingState')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-sm text-slate-400">
                  {t('admin.rulesets.league.emptyState')}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isArchivable = !row.is_builtin && !row.is_archived;
              const editable = !row.is_builtin && !row.is_archived;
              return (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  {showCheckboxCol && (
                    <td className="w-10 px-4 py-3">
                      {isArchivable && (
                        <input
                          type="checkbox"
                          aria-label={t('admin.rulesets.league.bulk.selectRowAria')}
                          checked={selection.has(row.id)}
                          onChange={() => selection.toggle(row.id)}
                          className="h-4 w-4 rounded border-slate-300 text-red-700 focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{row.name}</p>
                    {row.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {[1, 8, 16]
                      .map((r) => {
                        const v = pickPoints(row.points_by_rank, r);
                        return v === null ? '—' : String(v);
                      })
                      .join(' / ')}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.tie_breakers.length === 0 ? '—' : row.tie_breakers.join(' → ')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {row.is_builtin ? (
                        <>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {t('admin.rulesets.league.badges.builtin')}
                          </span>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            {t('admin.rulesets.league.badges.default')}
                          </span>
                        </>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {t('admin.rulesets.league.badges.custom')}
                        </span>
                      )}
                      {row.is_archived && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {t('admin.rulesets.league.badges.archived')}
                        </span>
                      )}
                    </div>
                  </td>
                  {showActionsCol && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {editable && (
                          <Link
                            href={`/admin/rulesets/league/${row.id}/edit`}
                            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                          >
                            {t('admin.rulesets.league.actions.edit')}
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => void doClone(row)}
                          disabled={busyId === row.id}
                          className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
                        >
                          {t('admin.rulesets.league.actions.clone')}
                        </button>
                        {row.is_archived && !row.is_builtin && (
                          <button
                            type="button"
                            onClick={() => void doRestore(row)}
                            disabled={busyId === row.id}
                            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
                          >
                            {t('admin.rulesets.league.actions.restore')}
                          </button>
                        )}
                        {isArchivable && (
                          <RowActionButton
                            variant="danger"
                            onClick={() => setPendingArchive(row)}
                            disabled={busyId === row.id}
                          >
                            {t('admin.rulesets.league.actions.archive')}
                          </RowActionButton>
                        )}
                        {row.is_builtin && (
                          <span className="text-xs text-slate-400">
                            {t('admin.rulesets.league.actions.readOnly')}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <BulkActionBar
          count={selection.count}
          itemLabel={{ singular: 'system', plural: 'systems' }}
          onClear={selection.clear}
        >
          <button
            type="button"
            onClick={() => setPendingBulkArchive(selectedRows)}
            className="inline-flex items-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('admin.rulesets.league.bulk.archiveSelected')}
          </button>
        </BulkActionBar>
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        title={t('admin.rulesets.league.confirm.archiveTitle')}
        description={
          pendingArchive
            ? t('admin.rulesets.league.confirm.archiveBody', { name: pendingArchive.name })
            : ''
        }
        confirmLabel={t('admin.rulesets.league.confirm.archiveAction')}
        danger
        busy={busyId === pendingArchive?.id}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void confirmArchive()}
      />

      <ConfirmDialog
        open={pendingBulkArchive !== null}
        title={
          pendingBulkArchive
            ? t('admin.rulesets.league.confirm.bulkArchiveTitle', {
                n: pendingBulkArchive.length,
              })
            : ''
        }
        description={t('admin.rulesets.league.confirm.bulkArchiveBody')}
        confirmLabel={t('admin.rulesets.league.confirm.bulkArchiveAction')}
        danger
        onCancel={() => setPendingBulkArchive(null)}
        onConfirm={() => void confirmBulkArchive()}
      />
    </>
  );
}
