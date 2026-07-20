'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  BulkActionBar,
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  PromptDialog,
  RowActionButton,
  rowActionClasses,
  useSelection,
  useToast,
} from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../src/components/rulesets/RulesetsTopNav';
import { CreateRulesetCta } from '../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../src/components/rulesets/RulesetBadge';

type RulesetStatus = 'pending' | 'approved' | 'rejected';

interface RulesetSubmission {
  id: string;
  code: string;
  version: string;
  display_name: string;
  description: string | null;
  submitted_by_user_id: string | null;
  package_ref: string | null;
  status: RulesetStatus;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

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

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function AdminRulesetsPage() {
  const { t, locale } = useI18n();

  // ── Submissions section state ──────────────────────────────────────────
  const [submissions, setSubmissions] = useState<RulesetSubmission[]>([]);
  const [submissionsStatus, setSubmissionsStatus] = useState<'all' | RulesetStatus>('pending');
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissionsRefreshKey, setSubmissionsRefreshKey] = useState(0);

  // ── Curated rulesets section state ─────────────────────────────────────
  const [curated, setCurated] = useState<CustomRuleset[]>([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [curatedRefreshKey, setCuratedRefreshKey] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const toast = useToast();
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  /**
   * R3: separate target for the per-row "Reject submission" action on the
   * curated custom_rulesets table. Reuses the same PromptDialog UX as the
   * legacy submissions-queue reject, but POSTs to the new
   * /admin/custom-rulesets/:id/reject-submission endpoint.
   */
  const [rejectSubmissionTarget, setRejectSubmissionTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // ── Bulk selection state ───────────────────────────────────────────────
  const selection = useSelection();
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const refreshSubmissions = useCallback(() => setSubmissionsRefreshKey((k) => k + 1), []);
  const refreshCurated = useCallback(() => setCuratedRefreshKey((k) => k + 1), []);

  // Submissions fetcher
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (submissionsStatus !== 'all') params.set('status', submissionsStatus);

    fetch(`${apiUrl}/api/v1/admin/rulesets?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(t('admin.rulesets.submissionsLoadError'));
        const data = (await res.json()) as RulesetSubmission[];
        if (!cancelled) setSubmissions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.rulesets.submissionsLoadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setSubmissionsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [submissionsStatus, submissionsRefreshKey, t]);

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

  async function approveSubmission(id: string) {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/rulesets/${id}/approve`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        toast.success(t('admin.rulesets.approveAction'));
        refreshSubmissions();
      } else {
        toast.error(t('admin.rulesets.actionFailed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmReject(reason: string) {
    if (!rejectTarget) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/rulesets/${rejectTarget}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.ok || res.status === 204) {
        toast.success(t('admin.rulesets.rejectAction'));
        setRejectTarget(null);
        refreshSubmissions();
      } else {
        toast.error(t('admin.rulesets.actionFailed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

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
   * R3: super-admin reject-submission on a curated row. Hits the new
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

  async function bulkApprove() {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/rulesets/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const result = (await res.json()) as {
          succeeded: number;
          failed: number;
          errors: { id: string; message: string }[];
        };
        if (result.failed === 0) {
          toast.success(
            t('admin.rulesets.bulkApproveSuccess', { count: String(result.succeeded) }),
          );
        } else {
          toast.warning(
            t('admin.rulesets.bulkPartial', {
              succeeded: String(result.succeeded),
              failed: String(result.failed),
            }),
          );
        }
        selection.clear();
        setBulkConfirmOpen(false);
        refreshSubmissions();
      } else {
        toast.error(t('admin.rulesets.actionFailed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function bulkReject(reason: string) {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/rulesets/bulk-reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids, reason: reason.trim() }),
      });
      if (res.ok) {
        const result = (await res.json()) as {
          succeeded: number;
          failed: number;
          errors: { id: string; message: string }[];
        };
        if (result.failed === 0) {
          toast.success(t('admin.rulesets.bulkRejectSuccess', { count: String(result.succeeded) }));
        } else {
          toast.warning(
            t('admin.rulesets.bulkPartial', {
              succeeded: String(result.succeeded),
              failed: String(result.failed),
            }),
          );
        }
        selection.clear();
        setBulkRejectOpen(false);
        refreshSubmissions();
      } else {
        toast.error(t('admin.rulesets.actionFailed'));
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
        toast.success(t('admin.rulesets.shared.actions.delete'));
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
    <main id="main-content" className="mx-auto max-w-[110rem] px-6 py-12 lg:px-8">
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

      {/* ── Submissions section ────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.rulesets.submissionsTitle')}
          </h2>
          <select
            value={submissionsStatus}
            onChange={(e) => setSubmissionsStatus(e.target.value as typeof submissionsStatus)}
            className="rounded-md border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="pending">{t('admin.rulesets.statusPending')}</option>
            <option value="approved">{t('admin.rulesets.statusApproved')}</option>
            <option value="rejected">{t('admin.rulesets.statusRejected')}</option>
            <option value="all">{t('admin.rulesets.statusAll')}</option>
          </select>
        </div>

        {submissionsLoading ? (
          <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.rulesets.submissionsEmpty')}</p>
        ) : (
          <DataTable>
            <DataTableHead>
              <DataTableCell as="th" className="w-10">
                <input
                  type="checkbox"
                  aria-label={t('admin.rulesets.selectAll')}
                  checked={submissions.length > 0 && submissions.every((s) => selection.has(s.id))}
                  onChange={() => selection.toggleAll(submissions.map((s) => s.id))}
                  className="h-4 w-4 cursor-pointer rounded border-border text-accent focus:ring-2 focus:ring-accent/30"
                />
              </DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colRuleset')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colPackage')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colSubmittedBy')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colStatus')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.colCreated')}</DataTableCell>
              <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
            </DataTableHead>
            <tbody>
              {submissions.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <input
                      type="checkbox"
                      aria-label={t('admin.rulesets.selectRow')}
                      checked={selection.has(row.id)}
                      onChange={() => selection.toggle(row.id)}
                      className="h-4 w-4 cursor-pointer rounded border-border text-accent focus:ring-2 focus:ring-accent/30"
                    />
                  </DataTableCell>
                  <DataTableCell>
                    <p className="font-medium">{row.display_name}</p>
                    <p className="font-mono text-xs text-muted">
                      {row.code}@{row.version}
                    </p>
                  </DataTableCell>
                  <DataTableCell mono>{row.package_ref ?? '-'}</DataTableCell>
                  <DataTableCell mono>{row.submitted_by_user_id ?? '-'}</DataTableCell>
                  <DataTableCell>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === 'approved'
                          ? 'bg-success/10 text-success'
                          : row.status === 'rejected'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {row.status}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-muted">
                    {new Date(row.created_at).toLocaleDateString(localeToBcp47(locale))}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex gap-2">
                      <RowActionButton
                        variant="success"
                        onClick={() => void approveSubmission(row.id)}
                        disabled={row.status === 'approved'}
                      >
                        {t('admin.rulesets.approveAction')}
                      </RowActionButton>
                      <RowActionButton
                        variant="danger"
                        onClick={() => setRejectTarget(row.id)}
                        disabled={row.status === 'rejected'}
                      >
                        {t('admin.rulesets.rejectAction')}
                      </RowActionButton>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

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
                      variant={row.status === 'published' ? 'published' : 'draft'}
                      label={
                        row.status === 'published'
                          ? t('admin.rulesets.shared.badges.published')
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
                      {/* R3: org-submitted rows show Approve/Reject actions. */}
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

      <PromptDialog
        open={rejectTarget !== null}
        title={t('admin.rulesets.rejectAction')}
        description={t('admin.rulesets.rejectReasonPrompt')}
        placeholder={t('admin.rulesets.rejectReasonPrompt')}
        confirmLabel={t('admin.rulesets.rejectAction')}
        danger
        multiline
        busy={actionBusy}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => void confirmReject(reason)}
      />

      {/* R3: per-row reject for org-submitted curated rulesets. */}
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        title={t('admin.rulesets.bulkApproveTitle')}
        description={t('admin.rulesets.bulkApproveConfirm', { count: String(selection.count) })}
        confirmLabel={t('admin.rulesets.approveAction')}
        busy={actionBusy}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => void bulkApprove()}
      />

      <PromptDialog
        open={bulkRejectOpen}
        title={t('admin.rulesets.bulkRejectTitle')}
        description={t('admin.rulesets.bulkRejectConfirm', { count: String(selection.count) })}
        placeholder={t('admin.rulesets.rejectReasonPrompt')}
        confirmLabel={t('admin.rulesets.rejectAction')}
        danger
        multiline
        busy={actionBusy}
        onCancel={() => setBulkRejectOpen(false)}
        onConfirm={(reason) => void bulkReject(reason)}
      />

      <BulkActionBar
        count={selection.count}
        itemLabel={{
          singular: t('admin.rulesets.bulkUnitSingular'),
          plural: t('admin.rulesets.bulkUnitPlural'),
        }}
        onClear={() => selection.clear()}
      >
        <button
          type="button"
          onClick={() => setBulkConfirmOpen(true)}
          disabled={actionBusy}
          className="rounded-md bg-success px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-success-hover disabled:opacity-50"
        >
          {t('admin.rulesets.bulkApproveAction')}
        </button>
        <button
          type="button"
          onClick={() => setBulkRejectOpen(true)}
          disabled={actionBusy}
          className="rounded-md bg-danger px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-danger-hover disabled:opacity-50"
        >
          {t('admin.rulesets.bulkRejectAction')}
        </button>
      </BulkActionBar>
    </main>
  );
}
