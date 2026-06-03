'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  PromptDialog,
  RowActionButton,
  rowActionClasses,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../src/components/rulesets/RulesetsTopNav';
import { CreateRulesetCta } from '../../../../src/components/rulesets/CreateRulesetCta';
import { RulesetBadge } from '../../../../src/components/rulesets/RulesetBadge';

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
  updated_at: string;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Rulesets"
        title={t('admin.penaltyRulesets.title')}
        subtitle={t('admin.penaltyRulesets.description')}
      />

      <RulesetsTopNav active="penalty" />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('admin.penaltyRulesets.curatedTitle')}
        </h2>
        <CreateRulesetCta
          href="/admin/rulesets/penalty/new"
          label={t('admin.penaltyRulesets.createButton')}
        />
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
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.name')}</th>
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.code')}</th>
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.version')}</th>
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.source')}</th>
                <th className="px-4 py-3">{t('admin.penaltyRulesets.colScope')}</th>
                <th className="px-4 py-3">{t('admin.rulesets.shared.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{row.name}</div>
                    {row.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {row.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.code}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                      v{row.version}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RulesetBadge
                      variant={row.built_in ? 'builtin' : 'custom'}
                      label={
                        row.built_in
                          ? t('admin.rulesets.shared.badges.builtin')
                          : t('admin.rulesets.shared.badges.custom')
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {t(`admin.penaltyRulesets.scope.${row.accumulation_scope}`)}
                  </td>
                  <td className="px-4 py-3">
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
                      <Link
                        href={`/admin/rulesets/penalty/${row.id}/edit`}
                        className={rowActionClasses('edit')}
                      >
                        {t('admin.rulesets.shared.actions.edit')}
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
                      {!row.built_in && (
                        <RowActionButton variant="danger" onClick={() => setDeleteTarget(row.id)}>
                          {t('admin.rulesets.shared.actions.delete')}
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
        title={t('admin.rulesets.shared.actions.delete')}
        description={t('admin.rulesets.shared.confirmDelete')}
        confirmLabel={t('admin.rulesets.shared.actions.delete')}
        cancelLabel={t('admin.rulesets.cancel')}
        danger
        busy={busy}
        onConfirm={confirmDelete}
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
