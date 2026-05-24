'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, RowActionButton, rowActionClasses, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';

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
        toast.success(t('admin.rulesets.deleteAction'));
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
        className: 'bg-emerald-100 text-emerald-800',
      };
    if (row.public_visibility_request_status === 'pending')
      return {
        label: t('admin.rulesets.submissionPending'),
        className: 'bg-amber-100 text-amber-800',
      };
    if (row.public_visibility_request_status === 'rejected')
      return {
        label: t('admin.rulesets.submissionRejected'),
        className: 'bg-red-100 text-red-800',
      };
    return null;
  }

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('admin.penaltyRulesets.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('admin.penaltyRulesets.description')}</p>
      </div>

      <RulesetsTopNav active="penalty" basePath={`/org/${params.slug}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('admin.penaltyRulesets.curatedTitle')}
        </h2>
        <Link
          href={`/org/${params.slug}/rulesets/penalty/new`}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800"
        >
          {t('admin.penaltyRulesets.createButton')}
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">{t('admin.penaltyRulesets.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">{t('admin.rulesets.colName')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colCode')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colVersion')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colSource')}</th>
                <th className="px-4 py-2">{t('admin.penaltyRulesets.colScope')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-slate-800">{row.name}</div>
                    {row.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {row.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.code}</td>
                  <td className="px-4 py-2 font-mono text-xs font-bold text-slate-700">
                    {row.version}
                  </td>
                  <td className="px-4 py-2">
                    {row.built_in ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        {t('admin.penaltyRulesets.sourceBuiltIn')}
                      </span>
                    ) : (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {t('admin.penaltyRulesets.sourceCustom')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {t(`admin.penaltyRulesets.scope.${row.accumulation_scope}`)}
                  </td>
                  <td className="px-4 py-2">
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
                      <Link
                        href={`/org/${params.slug}/rulesets/penalty/${row.id}/edit`}
                        className={rowActionClasses('edit')}
                      >
                        {row.built_in
                          ? t('admin.rulesets.viewAction')
                          : t('admin.rulesets.editAction')}
                      </Link>
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
                      {!row.built_in && (
                        <RowActionButton variant="danger" onClick={() => setDeleteTarget(row.id)}>
                          {t('admin.rulesets.deleteAction')}
                        </RowActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('admin.rulesets.deleteAction')}
        description={t('admin.rulesets.confirmDelete')}
        confirmLabel={t('admin.rulesets.deleteAction')}
        cancelLabel={t('admin.rulesets.cancel')}
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={submitShareTarget !== null}
        title={t('admin.rulesets.submitForReviewAction')}
        description={t('admin.rulesets.submitForReviewConfirm')}
        confirmLabel={t('admin.rulesets.submitForReviewAction')}
        cancelLabel={t('admin.rulesets.cancel')}
        busy={busy}
        onConfirm={confirmSubmitShare}
        onCancel={() => setSubmitShareTarget(null)}
      />
    </main>
  );
}
