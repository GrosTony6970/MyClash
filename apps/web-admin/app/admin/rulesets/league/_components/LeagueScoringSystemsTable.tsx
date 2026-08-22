'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BulkActionBar,
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  RowActionButton,
  rowActionClasses,
  useSelection,
  useToast,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { CreateRulesetCta } from '../../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../../src/components/rulesets/RulesetBadge';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

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
      const r = await apiRequest<LeagueScoringSystemRow[]>(
        apiUrl,
        '/api/v1/admin/league-scoring-systems',
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.rulesets.league.loadError'));
        if (message) setError(message);
        return;
      }
      setRows(r.data);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload() fetches then sets state; intentional initial data load
    void reload();
  }, [reload]);

  async function doClone(row: LeagueScoringSystemRow) {
    setBusyId(row.id);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/league-scoring-systems/${row.id}/clone`, {
        method: 'POST',
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.rulesets.league.cloneError'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.rulesets.league.toast.cloned', { name: row.name }));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function doSetDefault(row: LeagueScoringSystemRow) {
    setBusyId(row.id);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/league-scoring-systems/${row.id}/set-default`,
        { method: 'PATCH' },
      );
      if (!r.ok) {
        // Both failure paths here fell back to `toast.defaultSet` — the SUCCESS
        // string — so a refused set-default said "Default updated" in red.
        const message = failureMessage(r, t, t('admin.rulesets.shared.toast.defaultSetError'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.rulesets.shared.toast.defaultSet'));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/league-scoring-systems/${pendingDelete.id}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        // Same shape as set-default above: the refusal used to toast "Ruleset
        // deleted" in red.
        const message = failureMessage(r, t, t('admin.rulesets.shared.toast.deleteError'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.rulesets.shared.toast.deleted'));
      setPendingDelete(null);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmBulkDelete() {
    if (!pendingBulkDelete) return;
    let deleted = 0;
    let failed = 0;
    for (const row of pendingBulkDelete) {
      const r = await apiRequest(apiUrl, `/api/v1/admin/league-scoring-systems/${row.id}`, {
        method: 'DELETE',
      });
      if (r.ok) {
        deleted += 1;
        continue;
      }
      failed += 1;
      // Both arms of the old code named the row and then said "Ruleset
      // deleted" — the SUCCESS string — when the delete had not happened. The
      // dropped-connection arm said nothing else at all.
      const message = failureMessage(r, t, t('admin.rulesets.shared.toast.deleteError'));
      if (message) toast.error(`${row.name}: ${message}`);
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
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <DataTable className="min-w-[920px]">
        <DataTableHead>
          {showCheckboxCol && (
            <DataTableCell as="th" className="w-10">
              <input
                type="checkbox"
                aria-label={t('admin.rulesets.league.bulk.selectAllAria')}
                checked={deletableIds.length > 0 && deletableIds.every((id) => selection.has(id))}
                onChange={() => selection.toggleAll(deletableIds)}
                className="h-4 w-4 rounded border-border text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              />
            </DataTableCell>
          )}
          <DataTableCell as="th">{t('admin.rulesets.shared.columns.name')}</DataTableCell>
          <DataTableCell as="th">{t('admin.rulesets.shared.columns.code')}</DataTableCell>
          <DataTableCell as="th">{t('admin.rulesets.shared.columns.version')}</DataTableCell>
          <DataTableCell as="th">{t('admin.rulesets.shared.columns.source')}</DataTableCell>
          <DataTableCell as="th">{t('admin.rulesets.league.columns.points')}</DataTableCell>
          <DataTableCell as="th">{t('admin.rulesets.league.columns.tieBreakers')}</DataTableCell>
          {showActionsCol && (
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
          )}
        </DataTableHead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={colCount} className="py-8 text-center text-sm text-muted">
                {t('admin.rulesets.league.loadingState')}
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="py-12 text-center text-sm text-muted">
                {t('admin.rulesets.league.emptyState')}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const editable = !row.is_archived;
            return (
              <DataTableRow key={row.id}>
                {showCheckboxCol && (
                  <DataTableCell className="w-10">
                    <input
                      type="checkbox"
                      aria-label={t('admin.rulesets.league.bulk.selectRowAria')}
                      checked={selection.has(row.id)}
                      onChange={() => selection.toggle(row.id)}
                      className="h-4 w-4 rounded border-border text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    />
                  </DataTableCell>
                )}
                <DataTableCell>
                  <p className="font-medium text-foreground">{row.name}</p>
                  {row.description && (
                    <p className="mt-0.5 text-xs text-muted">{row.description}</p>
                  )}
                </DataTableCell>
                <DataTableCell mono>{row.code}</DataTableCell>
                <DataTableCell>
                  <span className="inline-block rounded-md bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground-secondary">
                    {t('admin.adminRulesetsReview.versionLabel', { version: row.version })}
                  </span>
                </DataTableCell>
                <DataTableCell>
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
                </DataTableCell>
                <DataTableCell className="text-foreground-secondary">
                  {[1, 8, 16]
                    .map((r) => {
                      const v = pickPoints(row.points_by_rank, r);
                      return v === null ? '—' : String(v);
                    })
                    .join(' / ')}
                </DataTableCell>
                <DataTableCell className="text-xs text-foreground-secondary">
                  {row.tie_breakers.length === 0 ? '—' : row.tie_breakers.join(' → ')}
                </DataTableCell>
                {showActionsCol && (
                  <DataTableCell>
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
                  </DataTableCell>
                )}
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>

      {!readOnly && (
        <BulkActionBar
          count={selection.count}
          itemLabel={{ singular: 'system', plural: 'systems' }}
          onClear={selection.clear}
        >
          <button
            type="button"
            onClick={() => setPendingBulkDelete(selectedRows)}
            className="inline-flex items-center rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-danger-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
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
