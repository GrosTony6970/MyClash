'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  PromptDialog,
  RowActionButton,
  rowActionClasses,
  useToast,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { RulesetsTopNav } from '../../../../src/components/rulesets/RulesetsTopNav';
import { CreateRulesetCta } from '../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../src/components/rulesets/RulesetBadge';
import { adminRulesetRowActions } from '../../../../src/components/rulesets/ruleset-row-actions';
import { getPublicApiUrl } from '@/lib/api-url';

interface PenaltyRulesetRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  owner_organization_id: string | null;
  built_in: boolean;
  public_visibility: boolean;
  accumulation_scope: 'match' | 'phase' | 'tournament';
  /** R3: sharing-request lifecycle for org-submitted promotion requests. */
  public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
  public_visibility_request_reason: string | null;
  /** Soft-archive timestamp (mig 0153): set when delisted while still referenced. */
  archived_at: string | null;
  updated_at: string;
}

const apiUrl = getPublicApiUrl();

export default function AdminPenaltyRulesetsPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [rows, setRows] = useState<PenaltyRulesetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [rejectShareTarget, setRejectShareTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // CSV import (POST /penalty-rulesets/import-csv existed with no UI —
  // bulk-loading a catalogue like FFAMHE required a script until now).
  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState({
    code: '',
    version: '1',
    name: '',
    accumulationScope: 'tournament' as 'match' | 'phase' | 'tournament',
    csv: '',
    fileName: '',
  });
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importForm.csv || !importForm.code.trim() || !importForm.name.trim()) return;
    setImporting(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/import-csv`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: importForm.code.trim(),
          version: importForm.version.trim() || '1',
          name: importForm.name.trim(),
          accumulationScope: importForm.accumulationScope,
          csv: importForm.csv,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.penaltyRulesets.importFailed'));
      }
      toast.success(t('admin.penaltyRulesets.importSuccess', { name: importForm.name.trim() }));
      setShowImport(false);
      setImportForm({
        code: '',
        version: '1',
        name: '',
        accumulationScope: 'tournament',
        csv: '',
        fileName: '',
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.penaltyRulesets.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/penalty-rulesets`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.penaltyRulesets.loadError'));
        return (await res.json()) as PenaltyRulesetRow[];
      })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.penaltyRulesets.loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshKey, t]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/${deleteTarget}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        // The API soft-archives (keeps it resolvable) instead of deleting when a
        // tournament still pins the ruleset — tell the operator which happened.
        const body = (await res.json().catch(() => null)) as { archived?: boolean } | null;
        toast.success(
          body?.archived
            ? t('admin.rulesets.shared.toast.archived')
            : t('admin.rulesets.shared.toast.deleted'),
        );
        setDeleteTarget(null);
        refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function approveSharing(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/${id}/approve-sharing`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success(t('admin.rulesets.approveForSharingSuccess'));
        refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmRejectSharing(reason: string) {
    if (!rejectShareTarget) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/penalty-rulesets/${rejectShareTarget}/reject-sharing`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (res.ok) {
        toast.success(t('admin.rulesets.rejectSubmissionSuccess'));
        setRejectShareTarget(null);
        refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Rulesets"
        title={t('admin.penaltyRulesets.title')}
        subtitle={t('admin.penaltyRulesets.description')}
      />

      <RulesetsTopNav active="penalty" />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('admin.penaltyRulesets.curatedTitle')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:border-muted"
          >
            {t('admin.penaltyRulesets.importButton')}
          </button>
          <CreateRulesetCta
            href="/admin/rulesets/penalty/new"
            label={t('admin.penaltyRulesets.createButton')}
          />
        </div>
      </div>

      {showImport && (
        <form
          onSubmit={(e) => void submitImport(e)}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <p className="text-sm text-muted">{t('admin.penaltyRulesets.importHint')}</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              {t('admin.penaltyRulesets.importName')}
              <input
                type="text"
                value={importForm.name}
                onChange={(e) => setImportForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              {t('admin.penaltyRulesets.importCode')}
              <input
                type="text"
                value={importForm.code}
                onChange={(e) => setImportForm((f) => ({ ...f, code: e.target.value }))}
                required
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              />
            </label>
            <label className="flex w-24 flex-col gap-1 text-sm font-medium text-foreground">
              {t('admin.penaltyRulesets.importVersion')}
              <input
                type="text"
                value={importForm.version}
                onChange={(e) => setImportForm((f) => ({ ...f, version: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              {t('admin.penaltyRulesets.colScope')}
              <select
                value={importForm.accumulationScope}
                onChange={(e) =>
                  setImportForm((f) => ({
                    ...f,
                    accumulationScope: e.target.value as 'match' | 'phase' | 'tournament',
                  }))
                }
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="match">{t('admin.penaltyRulesets.scope.match')}</option>
                <option value="phase">{t('admin.penaltyRulesets.scope.phase')}</option>
                <option value="tournament">{t('admin.penaltyRulesets.scope.tournament')}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={t('admin.penaltyRulesets.importFile')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  setImportForm((f) => ({ ...f, csv: text, fileName: file.name }));
                });
              }}
              className="text-sm text-foreground-secondary"
            />
            {importForm.fileName && (
              <span className="text-xs text-muted">{importForm.fileName}</span>
            )}
            <button
              type="submit"
              disabled={importing || !importForm.csv || !importForm.code.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {importing
                ? t('admin.penaltyRulesets.importing')
                : t('admin.penaltyRulesets.importSubmit')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.penaltyRulesets.empty')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.name')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.code')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.version')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.source')}</DataTableCell>
            <DataTableCell as="th">{t('admin.penaltyRulesets.colScope')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {rows.map((row) => {
              const actions = adminRulesetRowActions({
                builtIn: row.built_in,
                archived: Boolean(row.archived_at),
              });
              return (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <div className="font-semibold text-foreground">{row.name}</div>
                    {row.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                        {row.description}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell mono>{row.code}</DataTableCell>
                  <DataTableCell>
                    <span className="inline-block rounded-md bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground-secondary">
                      {t('admin.adminRulesetsReview.versionLabel', { version: row.version })}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <RulesetBadge
                        variant={row.built_in ? 'builtin' : 'custom'}
                        label={
                          row.built_in
                            ? t('admin.rulesets.shared.badges.builtin')
                            : t('admin.rulesets.shared.badges.custom')
                        }
                      />
                      {row.archived_at && (
                        <RulesetBadge
                          variant="archived"
                          label={t('admin.rulesets.shared.badges.archived')}
                        />
                      )}
                    </div>
                  </DataTableCell>
                  <DataTableCell className="text-xs text-foreground-secondary">
                    {t(`admin.penaltyRulesets.scope.${row.accumulation_scope}`)}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.public_visibility_request_status === 'pending' && (
                        <span
                          title={row.public_visibility_request_reason ?? undefined}
                          className="inline-flex"
                        >
                          <RulesetBadge
                            variant="pendingReview"
                            label={t('admin.rulesets.submissionPending')}
                          />
                        </span>
                      )}
                      {/* Archived rows drop to View: the server refuses to PATCH a
                          referenced ruleset, and archived means referenced. */}
                      <Link
                        href={`/admin/rulesets/penalty/${row.id}/edit`}
                        className={rowActionClasses(actions.edit ? 'edit' : 'neutral')}
                      >
                        {actions.edit
                          ? t('admin.rulesets.shared.actions.edit')
                          : t('admin.rulesets.viewAction')}
                      </Link>
                      {/* R3: org-submitted sharing requests show Approve / Reject actions. */}
                      {row.public_visibility_request_status === 'pending' && (
                        <>
                          <RowActionButton
                            variant="success"
                            onClick={() => void approveSharing(row.id)}
                          >
                            {t('admin.rulesets.approveForSharingAction')}
                          </RowActionButton>
                          <RowActionButton
                            variant="danger"
                            onClick={() => setRejectShareTarget(row.id)}
                          >
                            {t('admin.rulesets.rejectAction')}
                          </RowActionButton>
                        </>
                      )}
                      {actions.delete && (
                        <RowActionButton variant="danger" onClick={() => setDeleteTarget(row.id)}>
                          {t('admin.rulesets.shared.actions.delete')}
                        </RowActionButton>
                      )}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('admin.rulesets.shared.actions.delete')}
        description={t('admin.rulesets.shared.confirmDelete')}
        confirmLabel={t('admin.rulesets.shared.actions.delete')}
        cancelLabel={t('admin.rulesets.cancel')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <PromptDialog
        open={rejectShareTarget !== null}
        title={t('admin.rulesets.rejectAction')}
        description={t('admin.rulesets.rejectReasonPrompt')}
        placeholder={t('admin.rulesets.rejectReasonPrompt')}
        confirmLabel={t('admin.rulesets.rejectAction')}
        danger
        multiline
        busy={busy}
        onCancel={() => setRejectShareTarget(null)}
        onConfirm={(reason) => void confirmRejectSharing(reason)}
      />
    </main>
  );
}
