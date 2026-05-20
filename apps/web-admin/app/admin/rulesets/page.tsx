'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  BulkActionBar,
  ConfirmDialog,
  PromptDialog,
  useSelection,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

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
  updated_at: string;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function AdminRulesetsPage() {
  const { t } = useI18n();

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
    action: 'publish' | 'unpublish' | 'clone' | 'set-default',
  ) {
    const url = `${apiUrl}/api/v1/admin/custom-rulesets/${id}/${action}`;
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (res.ok || res.status === 204) {
      toast.success(
        t(`admin.rulesets.${action === 'set-default' ? 'setDefaultAction' : `${action}Action`}`),
      );
      refreshCurated();
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
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
        toast.success(t('admin.rulesets.deleteAction'));
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
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Rulesets"
        title={t('admin.rulesets.title')}
        subtitle={t('admin.rulesets.description')}
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Submissions section ────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('admin.rulesets.submissionsTitle')}
          </h2>
          <select
            value={submissionsStatus}
            onChange={(e) => setSubmissionsStatus(e.target.value as typeof submissionsStatus)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
          >
            <option value="pending">{t('admin.rulesets.statusPending')}</option>
            <option value="approved">{t('admin.rulesets.statusApproved')}</option>
            <option value="rejected">{t('admin.rulesets.statusRejected')}</option>
            <option value="all">{t('admin.rulesets.statusAll')}</option>
          </select>
        </div>

        {submissionsLoading ? (
          <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-slate-400">{t('admin.rulesets.submissionsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('admin.rulesets.selectAll')}
                      checked={
                        submissions.length > 0 && submissions.every((s) => selection.has(s.id))
                      }
                      onChange={() => selection.toggleAll(submissions.map((s) => s.id))}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-800 focus:ring-2 focus:ring-red-800/30"
                    />
                  </th>
                  <th className="px-4 py-2">{t('admin.rulesets.colRuleset')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colPackage')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colSubmittedBy')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colStatus')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colCreated')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={t('admin.rulesets.selectRow')}
                        checked={selection.has(row.id)}
                        onChange={() => selection.toggle(row.id)}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-800 focus:ring-2 focus:ring-red-800/30"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{row.display_name}</p>
                      <p className="font-mono text-xs text-slate-500">
                        {row.code}@{row.version}
                      </p>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {row.package_ref ?? '-'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {row.submitted_by_user_id ?? '-'}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status === 'approved'
                            ? 'bg-green-100 text-green-700'
                            : row.status === 'rejected'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {new Date(row.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => void approveSubmission(row.id)}
                          disabled={row.status === 'approved'}
                          className="text-xs text-green-700 hover:underline disabled:text-slate-300"
                        >
                          {t('admin.rulesets.approveAction')}
                        </button>
                        <button
                          onClick={() => setRejectTarget(row.id)}
                          disabled={row.status === 'rejected'}
                          className="text-xs text-red-700 hover:underline disabled:text-slate-300"
                        >
                          {t('admin.rulesets.rejectAction')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Curated rulesets section ───────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('admin.rulesets.curatedTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t('admin.rulesets.curatedDescription')}</p>
          </div>
          <Link
            href="/admin/rulesets/new"
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            + {t('admin.rulesets.createButton')}
          </Link>
        </div>

        {curatedLoading ? (
          <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
        ) : curated.length === 0 ? (
          <p className="text-sm text-slate-400">{t('admin.rulesets.curatedEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">{t('admin.rulesets.colName')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colCodeVersion')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colSource')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colStatus')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colDefault')}</th>
                  <th className="px-4 py-2">{t('admin.rulesets.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {curated.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      {row.description ? (
                        <p className="mt-0.5 max-w-md text-xs text-slate-500">{row.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {row.code}@{row.version}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                          row.is_system
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {row.is_system
                          ? t('admin.rulesets.sourceSystem')
                          : t('admin.rulesets.sourceCustom')}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status === 'published'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {row.status === 'published'
                          ? t('admin.rulesets.statusPublished')
                          : t('admin.rulesets.statusDraft')}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {row.is_default ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          ★ {t('admin.rulesets.defaultBadge')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/rulesets/${row.id}/edit`}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          {row.is_system
                            ? t('admin.rulesets.viewAction')
                            : t('admin.rulesets.editAction')}
                        </Link>
                        <button
                          type="button"
                          onClick={() => void performCuratedAction(row.id, 'clone')}
                          className="text-xs font-semibold text-slate-700 hover:underline"
                        >
                          {t('admin.rulesets.cloneAction')}
                        </button>
                        {!row.is_system && row.status !== 'published' ? (
                          <button
                            type="button"
                            onClick={() => void performCuratedAction(row.id, 'publish')}
                            className="text-xs font-semibold text-green-700 hover:underline"
                          >
                            {t('admin.rulesets.publishAction')}
                          </button>
                        ) : null}
                        {!row.is_system && row.status === 'published' ? (
                          <button
                            type="button"
                            onClick={() => void performCuratedAction(row.id, 'unpublish')}
                            className="text-xs font-semibold text-amber-700 hover:underline"
                          >
                            {t('admin.rulesets.unpublishAction')}
                          </button>
                        ) : null}
                        {row.status === 'published' && !row.is_default ? (
                          <button
                            type="button"
                            onClick={() => void performCuratedAction(row.id, 'set-default')}
                            className="text-xs font-semibold text-amber-700 hover:underline"
                          >
                            {t('admin.rulesets.setDefaultAction')}
                          </button>
                        ) : null}
                        {!row.is_system ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(row.id)}
                            className="text-xs font-semibold text-red-700 hover:underline"
                          >
                            {t('admin.rulesets.deleteAction')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('admin.rulesets.deleteAction')}
        description={t('admin.rulesets.confirmDelete')}
        confirmLabel={t('admin.rulesets.deleteAction')}
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
          className="rounded-md bg-green-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-800 disabled:opacity-50"
        >
          {t('admin.rulesets.bulkApproveAction')}
        </button>
        <button
          type="button"
          onClick={() => setBulkRejectOpen(true)}
          disabled={actionBusy}
          className="rounded-md bg-red-800 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-900 disabled:opacity-50"
        >
          {t('admin.rulesets.bulkRejectAction')}
        </button>
      </BulkActionBar>
    </main>
  );
}
