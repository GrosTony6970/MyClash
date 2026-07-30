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
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../src/components/rulesets/RulesetsTopNav';
import { CreateRulesetCta } from '../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../src/components/rulesets/RulesetBadge';
import { getPublicApiUrl } from '@/lib/api-url';

interface CustomRuleset {
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
  updated_at: string;
}

const apiUrl = getPublicApiUrl();

export default function AdminRulesetsPage() {
  const { t } = useI18n();

  // ── Curated rulesets section state ─────────────────────────────────────
  const [curated, setCurated] = useState<CustomRuleset[]>([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [curatedRefreshKey, setCuratedRefreshKey] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const toast = useToast();
  /**
   * Per-row "Reject submission" action on an org-submitted curated row.
   * POSTs to /admin/custom-rulesets/:id/reject-submission — the single
   * super-admin approve/reject path now that the legacy ruleset_submissions
   * queue is retired.
   */
  const [rejectSubmissionTarget, setRejectSubmissionTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const refreshCurated = useCallback(() => setCuratedRefreshKey((k) => k + 1), []);

  // Curated fetcher
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/custom-rulesets`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(t('admin.rulesets.curatedLoadError'));
        return (await res.json()) as CustomRuleset[];
      })
      .then((data) => {
        if (!cancelled && data) setCurated(data);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.rulesets.curatedLoadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setCuratedLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [curatedRefreshKey, t]);

  async function performCuratedAction(
    id: string,
    action: 'publish' | 'unpublish' | 'clone' | 'set-default' | 'approve-public',
  ) {
    const url = `${apiUrl}/api/v1/admin/custom-rulesets/${id}/${action}`;
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (res.ok || res.status === 204) {
      toast.success(
        t(
          `admin.rulesets.${
            action === 'set-default'
              ? 'setDefaultAction'
              : action === 'approve-public'
                ? 'approveForSharingSuccess'
                : `${action}Action`
          }`,
        ),
      );
      refreshCurated();
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
    }
  }

  /**
   * Super-admin reject-submission on a curated row. Hits the
   * /admin/custom-rulesets/:id/reject-submission endpoint with a reason
   * captured via PromptDialog.
   */
  async function confirmRejectSubmission(reason: string) {
    if (!rejectSubmissionTarget) return;
    setActionBusy(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/custom-rulesets/${rejectSubmissionTarget}/reject-submission`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (res.ok) {
        toast.success(t('admin.rulesets.rejectSubmissionSuccess'));
        setRejectSubmissionTarget(null);
        refreshCurated();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${deleteTarget}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        // Soft-archived (kept resolvable) rather than deleted when a tournament
        // still pins it — reflect which happened.
        const body = (await res.json().catch(() => null)) as { archived?: boolean } | null;
        toast.success(
          body?.archived
            ? t('admin.rulesets.shared.toast.archived')
            : t('admin.rulesets.shared.toast.deleted'),
        );
        setDeleteTarget(null);
        refreshCurated();
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Rulesets"
        title={t('admin.rulesets.title')}
        subtitle={t('admin.rulesets.description')}
      />

      <RulesetsTopNav active="scoring" />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ── Curated rulesets section ───────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('admin.rulesets.curatedTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('admin.rulesets.curatedDescription')}</p>
          </div>
          <CreateRulesetCta
            href="/admin/rulesets/scoring/new"
            label={t('admin.rulesets.createButton')}
          />
        </div>

        {curatedLoading ? (
          <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
        ) : curated.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.rulesets.curatedEmpty')}</p>
        ) : (
          <DataTable>
            <DataTableHead>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.name')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.code')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.version')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.source')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colStatus')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colDefault')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
            </DataTableHead>
            <tbody>
              {curated.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <p className="font-medium text-foreground">{row.name}</p>
                    {row.description ? (
                      <p className="mt-0.5 max-w-md text-xs text-muted">{row.description}</p>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell mono>{row.code}</DataTableCell>
                  <DataTableCell>
                    <span className="inline-block rounded-md bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground-secondary">
                      {t('admin.adminRulesetsReview.versionLabel', { version: row.version })}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <RulesetBadge
                      variant={row.is_system ? 'builtin' : 'custom'}
                      label={
                        row.is_system
                          ? t('admin.rulesets.shared.badges.builtin')
                          : t('admin.rulesets.shared.badges.custom')
                      }
                    />
                  </DataTableCell>
                  <DataTableCell>
                    <RulesetBadge
                      variant={
                        row.status === 'published'
                          ? 'published'
                          : row.status === 'archived'
                            ? 'archived'
                            : 'draft'
                      }
                      label={
                        row.status === 'published'
                          ? t('admin.rulesets.shared.badges.published')
                          : row.status === 'archived'
                            ? t('admin.rulesets.shared.badges.archived')
                            : t('admin.rulesets.shared.badges.draft')
                      }
                    />
                  </DataTableCell>
                  <DataTableCell>
                    {row.is_default ? (
                      <RulesetBadge
                        variant="default"
                        label={t('admin.rulesets.shared.badges.default')}
                      />
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap gap-2">
                      {row.submitted_for_review_at && (
                        <RulesetBadge
                          variant="pendingReview"
                          label={t('admin.rulesets.submissionPending')}
                        />
                      )}
                      <Link
                        href={`/admin/rulesets/scoring/${row.id}/edit`}
                        className={rowActionClasses('edit')}
                      >
                        {row.is_system
                          ? t('admin.rulesets.viewAction')
                          : t('admin.rulesets.shared.actions.edit')}
                      </Link>
                      {/* Org-submitted rows show Approve/Reject actions. */}
                      {row.submitted_for_review_at && (
                        <>
                          <RowActionButton
                            variant="success"
                            onClick={() => void performCuratedAction(row.id, 'approve-public')}
                          >
                            {t('admin.rulesets.approveForSharingAction')}
                          </RowActionButton>
                          <RowActionButton
                            variant="danger"
                            onClick={() => setRejectSubmissionTarget(row.id)}
                          >
                            {t('admin.rulesets.rejectAction')}
                          </RowActionButton>
                        </>
                      )}
                      {/* Not offered for built-ins, matching Publish/Unpublish
                          below and the server-side guard. A system row's
                          score_formula is an empty placeholder that only works
                          while is_system is TRUE, so a copy of one is a ruleset
                          with no ranking algorithm at all. Cloning a built-in
                          lives on the org side (?cloneFrom=), which requires an
                          authored formula before it will save. */}
                      {!row.is_system && (
                        <RowActionButton
                          variant="neutral"
                          onClick={() => void performCuratedAction(row.id, 'clone')}
                        >
                          {t('admin.rulesets.shared.actions.clone')}
                        </RowActionButton>
                      )}
                      {!row.is_system && row.status !== 'published' ? (
                        <RowActionButton
                          variant="success"
                          onClick={() => void performCuratedAction(row.id, 'publish')}
                        >
                          {t('admin.rulesets.publishAction')}
                        </RowActionButton>
                      ) : null}
                      {!row.is_system && row.status === 'published' ? (
                        <RowActionButton
                          variant="warning"
                          onClick={() => void performCuratedAction(row.id, 'unpublish')}
                        >
                          {t('admin.rulesets.unpublishAction')}
                        </RowActionButton>
                      ) : null}
                      {row.status === 'published' && !row.is_default ? (
                        <RowActionButton
                          variant="neutral"
                          onClick={() => void performCuratedAction(row.id, 'set-default')}
                        >
                          {t('admin.rulesets.setDefaultAction')}
                        </RowActionButton>
                      ) : null}
                      {!row.is_system ? (
                        <RowActionButton variant="danger" onClick={() => setDeleteTarget(row.id)}>
                          {t('admin.rulesets.shared.actions.delete')}
                        </RowActionButton>
                      ) : null}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {/* Per-row reject for org-submitted curated rulesets. */}
      <PromptDialog
        open={rejectSubmissionTarget !== null}
        title={t('admin.rulesets.rejectAction')}
        description={t('admin.rulesets.rejectReasonPrompt')}
        placeholder={t('admin.rulesets.rejectReasonPrompt')}
        confirmLabel={t('admin.rulesets.rejectAction')}
        danger
        multiline
        busy={actionBusy}
        onCancel={() => setRejectSubmissionTarget(null)}
        onConfirm={(reason) => void confirmRejectSubmission(reason)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('admin.rulesets.shared.actions.delete')}
        description={t('admin.rulesets.shared.confirmDelete')}
        confirmLabel={t('admin.rulesets.shared.actions.delete')}
        danger
        busy={actionBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}
