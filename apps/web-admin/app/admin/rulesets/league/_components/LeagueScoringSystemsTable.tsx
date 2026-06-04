'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BulkActionBar,
  ConfirmDialog,
  RowActionButton,
  rowActionClasses,
  useSelection,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { CreateRulesetCta } from '../../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../../src/components/rulesets/RulesetBadge';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface LeagueScoringSystemRow {
  id: string;
  code: string;
  name: string;
  version: string;
  is_builtin: boolean;
  is_archived: boolean;
  is_default: boolean;
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
  const toast = useToast();

  const [rows, setRows] = useState<LeagueScoringSystemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LeagueScoringSystemRow | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<LeagueScoringSystemRow[] | null>(null);

  const selection = useSelection();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, {
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
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  async function doSetDefault(row: LeagueScoringSystemRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${row.id}/set-default`,
        { method: 'PATCH', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.shared.toast.defaultSet'));
      }
      toast.success(t('admin.rulesets.shared.toast.defaultSet'));
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.rulesets.shared.toast.defaultSet'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems/${pendingDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.shared.toast.deleted'));
      }
      toast.success(t('admin.rulesets.shared.toast.deleted'));
      setPendingDelete(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.rulesets.shared.toast.deleted'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmBulkDelete() {
    if (!pendingBulkDelete) return;
    let deleted = 0;
    let failed = 0;
    for (const row of pendingBulkDelete) {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems/${row.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          failed += 1;
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error(`${row.name}: ${body.message ?? t('admin.rulesets.shared.toast.deleted')}`);
        } else {
          deleted += 1;
        }
      } catch {
        failed += 1;
        toast.error(`${row.name}: ${t('admin.rulesets.shared.toast.deleted')}`);
      }
    }
    toast.success(t('admin.rulesets.league.toast.bulkDeleted', { n: deleted, failed }));
    setPendingBulkDelete(null);
    selection.clear();
    await reload();
  }

  // Built-ins were previously excluded; with slice 2's lift, super-admin
  // can delete any row that isn't currently used by a league (the BE
  // enforces the in-use guard on every DELETE).
  const deletableRows = useMemo(() => rows, [rows]);
  const deletableIds = useMemo(() => deletableRows.map((r) => r.id), [deletableRows]);
  const selectedRows = useMemo(() => rows.filter((r) => selection.has(r.id)), [rows, selection]);

  const showActionsCol = !readOnly;
  const showCheckboxCol = !readOnly;
  const colCount = 6 + (showCheckboxCol ? 1 : 0) + (showActionsCol ? 1 : 0);

  return (
    <>
      {!readOnly && (
        <div className="mb-4 flex items-center justify-end">
          <CreateRulesetCta
            href="/admin/rulesets/league/new"
            label={t('admin.rulesets.league.newButton')}
          />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              {showCheckboxCol && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t('admin.rulesets.league.bulk.selectAllAria')}
                    checked={
                      deletableIds.length > 0 && deletableIds.every((id) => selection.has(id))
                    }
                    onChange={() => selection.toggleAll(deletableIds)}
                    className="h-4 w-4 rounded border-slate-300 text-red-700 focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                  />
                </th>
              )}
              <th className="px-4 py-3">{t('admin.rulesets.shared.columns.name')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.shared.columns.code')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.shared.columns.version')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.shared.columns.source')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.points')}</th>
              <th className="px-4 py-3">{t('admin.rulesets.league.columns.tieBreakers')}</th>
              {showActionsCol && (
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.actions')}</th>
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
              const editable = !row.is_archived;
              return (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  {showCheckboxCol && (
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={t('admin.rulesets.league.bulk.selectRowAria')}
                        checked={selection.has(row.id)}
                        onChange={() => selection.toggle(row.id)}
                        className="h-4 w-4 rounded border-slate-300 text-red-700 focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{row.name}</p>
                    {row.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.code}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                      v{row.version}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <RulesetBadge
                        variant={row.is_builtin ? 'builtin' : 'custom'}
                        label={
                          row.is_builtin
                            ? t('admin.rulesets.shared.badges.builtin')
                            : t('admin.rulesets.shared.badges.custom')
                        }
                      />
                      {row.is_default && (
                        <RulesetBadge
                          variant="default"
                          label={t('admin.rulesets.shared.badges.default')}
                        />
                      )}
                    </div>
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
                  {showActionsCol && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && (
                          <Link
                            href={`/admin/rulesets/league/${row.id}/edit`}
                            className={rowActionClasses('edit')}
                          >
                            {t('admin.rulesets.shared.actions.edit')}
                          </Link>
                        )}
                        <RowActionButton
                          variant="neutral"
                          onClick={() => void doClone(row)}
                          disabled={busyId === row.id}
                        >
                          {t('admin.rulesets.shared.actions.clone')}
                        </RowActionButton>
                        {!row.is_default && (
                          <RowActionButton
                            variant="neutral"
                            onClick={() => void doSetDefault(row)}
                            disabled={busyId === row.id}
                          >
                            {t('admin.rulesets.shared.actions.setDefault')}
                          </RowActionButton>
                        )}
                        <RowActionButton
                          variant="danger"
                          onClick={() => setPendingDelete(row)}
                          disabled={busyId === row.id}
                        >
                          {t('admin.rulesets.shared.actions.delete')}
                        </RowActionButton>
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
            onClick={() => setPendingBulkDelete(selectedRows)}
            className="inline-flex items-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('admin.rulesets.league.bulk.deleteSelected')}
          </button>
        </BulkActionBar>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('admin.rulesets.shared.actions.delete')}
        description={
          pendingDelete
            ? t('admin.rulesets.league.confirm.deleteBody', { name: pendingDelete.name })
            : ''
        }
        confirmLabel={t('admin.rulesets.shared.actions.delete')}
        danger
        busy={busyId === pendingDelete?.id}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={pendingBulkDelete !== null}
        title={
          pendingBulkDelete
            ? t('admin.rulesets.league.confirm.bulkDeleteTitle', {
                n: pendingBulkDelete.length,
              })
            : ''
        }
        description={t('admin.rulesets.league.confirm.bulkDeleteBody')}
        confirmLabel={t('admin.rulesets.shared.actions.delete')}
        danger
        onCancel={() => setPendingBulkDelete(null)}
        onConfirm={() => void confirmBulkDelete()}
      />
    </>
  );
}
