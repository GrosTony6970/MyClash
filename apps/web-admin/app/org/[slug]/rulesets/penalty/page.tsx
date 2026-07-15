'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  RowActionButton,
  rowActionClasses,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { rulesetRowActions } from '../../../../../src/components/rulesets/ruleset-row-actions';

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
  /** R3: sharing-request lifecycle for promoting an org row to public. */
  public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
  public_visibility_request_reason: string | null;
  updated_at: string;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function OrgPenaltyRulesetsPage() {
  const params = useParams<{ slug: string }>();
  // Guard against transient `params.slug === undefined`. See
  // organizer-auth-decision.ts for the downstream fix that catches
  // the auth-gate redirect this prevented before.
  const slugForLink = params.slug ?? '';
  const { t } = useI18n();
  const toast = useToast();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [rows, setRows] = useState<PenaltyRulesetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [submitShareTarget, setSubmitShareTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Resolve org id from slug once.
  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.penaltyRulesets.loadError'));
        return (await res.json()) as { id: string };
      })
      .then((org) => {
        if (!cancelled) setOrgId(org.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('admin.penaltyRulesets.loadError'));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.slug, t]);

  // List rulesets visible to this org once the orgId is known.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/${orgId}/penalty-rulesets`, {
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
  }, [orgId, refreshKey, t]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/${deleteTarget}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        toast.success(t('admin.rulesets.shared.actions.delete'));
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

  async function confirmSubmitShare() {
    if (!submitShareTarget) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/penalty-rulesets/${submitShareTarget}/submit-for-sharing`,
        { method: 'POST', credentials: 'include' },
      );
      if (res.ok) {
        toast.success(t('admin.rulesets.submitForReviewSuccess'));
        setSubmitShareTarget(null);
        refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  function sharingBadge(row: PenaltyRulesetRow): { label: string; className: string } | null {
    if (!row.owner_organization_id || row.owner_organization_id !== orgId) return null;
    if (row.public_visibility)
      return {
        label: t('admin.rulesets.submissionApproved'),
        className: 'bg-success/10 text-success',
      };
    if (row.public_visibility_request_status === 'pending')
      return {
        label: t('admin.rulesets.submissionPending'),
        className: 'bg-warning/10 text-warning',
      };
    if (row.public_visibility_request_status === 'rejected')
      return {
        label: t('admin.rulesets.submissionRejected'),
        className: 'bg-danger/10 text-danger',
      };
    return null;
  }

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('admin.penaltyRulesets.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('admin.penaltyRulesets.description')}</p>
      </div>

      <RulesetsTopNav active="penalty" basePath={`/org/${slugForLink}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('admin.penaltyRulesets.curatedTitle')}
        </h2>
        <Link
          href={`/org/${slugForLink}/rulesets/penalty/new`}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t('admin.penaltyRulesets.createButton')}
        </Link>
      </div>

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
              const actions = rulesetRowActions({
                builtIn: row.built_in,
                mine: row.owner_organization_id === orgId,
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
                  <DataTableCell mono className="font-bold">
                    {row.version}
                  </DataTableCell>
                  <DataTableCell>
                    {row.built_in ? (
                      <span className="rounded bg-success/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-success">
                        {t('admin.rulesets.shared.badges.builtin')}
                      </span>
                    ) : (
                      <span className="rounded bg-background px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                        {t('admin.rulesets.shared.badges.custom')}
                      </span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-foreground-secondary">
                    {t(`admin.penaltyRulesets.scope.${row.accumulation_scope}`)}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const badge = sharingBadge(row);
                        return badge ? (
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${badge.className}`}
                            title={row.public_visibility_request_reason ?? undefined}
                          >
                            {badge.label}
                          </span>
                        ) : null;
                      })()}
                      {actions.view && (
                        <Link
                          href={`/org/${slugForLink}/rulesets/penalty/${row.id}/edit`}
                          className={rowActionClasses('neutral')}
                        >
                          {t('admin.rulesets.viewAction')}
                        </Link>
                      )}
                      {actions.edit && (
                        <Link
                          href={`/org/${slugForLink}/rulesets/penalty/${row.id}/edit`}
                          className={rowActionClasses('edit')}
                        >
                          {t('admin.rulesets.shared.actions.edit')}
                        </Link>
                      )}
                      {actions.clone && (
                        <Link
                          href={`/org/${slugForLink}/rulesets/penalty/new?cloneFrom=${row.id}`}
                          className={rowActionClasses('neutral')}
                        >
                          {t('admin.rulesets.shared.actions.clone')}
                        </Link>
                      )}
                      {/* R3: Submit for sharing — only on org-owned rows
                        that aren't already public and aren't pending review. */}
                      {!row.built_in &&
                        row.owner_organization_id === orgId &&
                        !row.public_visibility &&
                        row.public_visibility_request_status !== 'pending' && (
                          <RowActionButton
                            variant="success"
                            onClick={() => setSubmitShareTarget(row.id)}
                          >
                            {t('admin.rulesets.submitForReviewAction')}
                          </RowActionButton>
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

      <ConfirmDialog
        open={submitShareTarget !== null}
        title={t('admin.rulesets.submitForReviewAction')}
        description={t('admin.rulesets.submitForReviewConfirm')}
        confirmLabel={t('admin.rulesets.submitForReviewAction')}
        cancelLabel={t('admin.rulesets.cancel')}
        busy={busy}
        onConfirm={() => void confirmSubmitShare()}
        onCancel={() => setSubmitShareTarget(null)}
      />
    </main>
  );
}
