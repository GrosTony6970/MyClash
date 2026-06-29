'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, RowActionButton, rowActionClasses, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { rulesetRowActions } from '../../../../../src/components/rulesets/ruleset-row-actions';

interface CustomRulesetRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  is_default: boolean;
  is_system: boolean;
  owner_organization_id: string | null;
  public_visibility: boolean;
  submitted_for_review_at: string | null;
  rejected_reason: string | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Organizer-side scoring rulesets tab — Round 2: full authoring.
 *
 * The catalog now includes:
 *   - System rulesets (TF v1, Generic_PointsCap) — read-only.
 *   - Other orgs' rulesets that a super-admin approved for public sharing — read-only.
 *   - The org's own scoring rulesets — editable + deletable. Each carries a
 *     submission status: not submitted, pending review, rejected (with
 *     reason), or approved & public.
 *
 * Actions per row:
 *   - Edit / Delete — only on the org's own.
 *   - Submit for review — only on the org's own that aren't already pending
 *     or public.
 */
export default function OrgScoringRulesetsPage() {
  const params = useParams<{ slug: string }>();
  // Guard against `params.slug` being momentarily undefined during a route
  // transition. Without this, template literals like `/org/${params.slug}/...`
  // stringify undefined into the URL → `/org/undefined/...` → auth-gate
  // bounce. See organizer-auth-decision.ts for the downstream fix.
  const slugForLink = params.slug ?? '';
  const { t } = useI18n();
  const toast = useToast();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [rows, setRows] = useState<CustomRulesetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [submitTarget, setSubmitTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.curatedLoadError'));
        return (await res.json()) as { id: string };
      })
      .then((org) => {
        if (!cancelled) setOrgId(org.id);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t('admin.rulesets.curatedLoadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [params.slug, t]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.curatedLoadError'));
        return (await res.json()) as CustomRulesetRow[];
      })
      .then((data) => {
        if (!cancelled) setRows(data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.rulesets.curatedLoadError'));
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
    if (!deleteTarget || !orgId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/${deleteTarget}`,
        { method: 'DELETE', credentials: 'include' },
      );
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

  async function confirmSubmit() {
    if (!submitTarget || !orgId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/${submitTarget}/submit`,
        { method: 'POST', credentials: 'include' },
      );
      if (res.ok) {
        toast.success(t('admin.rulesets.submitForReviewSuccess'));
        setSubmitTarget(null);
        refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  function rowSource(row: CustomRulesetRow): { label: string; className: string } {
    if (row.is_system)
      return {
        label: t('admin.rulesets.shared.badges.builtin'),
        className: 'bg-success/10 text-success',
      };
    if (row.owner_organization_id === orgId)
      return { label: t('admin.rulesets.sourceMine'), className: 'bg-info/10 text-info' };
    return {
      label: t('admin.rulesets.sourceShared'),
      className: 'bg-purple-100 text-purple-800',
    };
  }

  function rowSubmissionBadge(row: CustomRulesetRow): { label: string; className: string } | null {
    if (row.is_system || row.owner_organization_id !== orgId) return null;
    if (row.public_visibility)
      return {
        label: t('admin.rulesets.submissionApproved'),
        className: 'bg-success/10 text-success',
      };
    if (row.submitted_for_review_at)
      return {
        label: t('admin.rulesets.submissionPending'),
        className: 'bg-warning/10 text-warning',
      };
    if (row.rejected_reason)
      return {
        label: t('admin.rulesets.submissionRejected'),
        className: 'bg-danger/10 text-danger',
      };
    return {
      label: t('admin.rulesets.submissionNotSubmitted'),
      className: 'bg-background text-foreground-secondary',
    };
  }

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('admin.rulesets.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('admin.rulesets.description')}</p>
      </div>

      <RulesetsTopNav active="scoring" basePath={`/org/${slugForLink}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('admin.rulesets.curatedTitle')}
        </h2>
        <Link
          href={`/org/${slugForLink}/rulesets/scoring/new`}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t('admin.rulesets.createButton')}
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.rulesets.curatedEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.name')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.code')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.version')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.source')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colSubmission')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isMine = row.owner_organization_id === orgId;
                const source = rowSource(row);
                const submissionBadge = rowSubmissionBadge(row);
                const canSubmit = isMine && !row.public_visibility && !row.submitted_for_review_at;
                const actions = rulesetRowActions({ builtIn: row.is_system, mine: isMine });
                return (
                  <tr key={row.id} className="border-b border-border">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-foreground">{row.name}</div>
                      {row.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                          {row.description}
                        </div>
                      )}
                      {row.rejected_reason && (
                        <div className="mt-1 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
                          {t('admin.rulesets.rejectedReasonLabel')}: {row.rejected_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-foreground-secondary">
                      {row.code}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs font-bold text-foreground-secondary">
                      {row.version}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${source.className}`}
                      >
                        {source.label}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {submissionBadge ? (
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${submissionBadge.className}`}
                        >
                          {submissionBadge.label}
                        </span>
                      ) : (
                        <span className="text-xs italic text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {actions.view && (
                          <Link
                            href={`/org/${slugForLink}/rulesets/scoring/${row.id}/edit`}
                            className={rowActionClasses('neutral')}
                          >
                            {t('admin.rulesets.viewAction')}
                          </Link>
                        )}
                        {actions.edit && (
                          <Link
                            href={`/org/${slugForLink}/rulesets/scoring/${row.id}/edit`}
                            className={rowActionClasses('edit')}
                          >
                            {t('admin.rulesets.shared.actions.edit')}
                          </Link>
                        )}
                        {actions.clone && (
                          <Link
                            href={`/org/${slugForLink}/rulesets/scoring/new?cloneFrom=${row.id}`}
                            className={rowActionClasses('neutral')}
                          >
                            {t('admin.rulesets.shared.actions.clone')}
                          </Link>
                        )}
                        {canSubmit && (
                          <RowActionButton
                            variant="success"
                            onClick={() => setSubmitTarget(row.id)}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
        open={submitTarget !== null}
        title={t('admin.rulesets.submitForReviewAction')}
        description={t('admin.rulesets.submitForReviewConfirm')}
        confirmLabel={t('admin.rulesets.submitForReviewAction')}
        cancelLabel={t('admin.rulesets.cancel')}
        busy={busy}
        onConfirm={() => void confirmSubmit()}
        onCancel={() => setSubmitTarget(null)}
      />
    </main>
  );
}
