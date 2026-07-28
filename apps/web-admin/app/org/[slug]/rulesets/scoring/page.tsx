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
  SegmentedTabs,
  useToast,
} from '@myclash/ui';
import type { BucketDiff } from '@myclash/rulesets';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { rulesetRowActions } from '../../../../../src/components/rulesets/ruleset-row-actions';
import { RulesetDiscoverTab } from '../../../../../src/components/rulesets/RulesetDiscoverTab';
import { LineageLamps } from '../../../../../src/components/rulesets/LineageLamps';
import { RulesetImportButton } from '../../../../../src/components/rulesets/RulesetImportButton';
import { ScoringManageActions } from './_components/ScoringManageActions';
import { toScoringDiscoverCards } from './_components/scoring-discover-cards';
import { rulesetSourceBadge, rulesetSubmissionBadge } from './_components/manage-row-badges';
import { getPublicApiUrl } from '@/lib/api-url';

type RulesetsTab = 'manage' | 'discover';

function isTabKey(value: string | null): value is RulesetsTab {
  return value === 'manage' || value === 'discover';
}

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
  /** Set on a coded fork ("Customise this format"): the built-in it reuses. */
  base_code: string | null;
  /**
   * Server-computed lineage vs that base — the same field, and the same
   * computation, the Discover cards and the edit page read. Never derived
   * client-side: only the server can project a base's effective behaviour.
   */
  lineage: { base: string; diff: BucketDiff } | null;
}

const apiUrl = getPublicApiUrl();

/**
 * Organizer-side scoring rulesets, split into two tabs:
 *   - Manage — the org's own rulesets (edit / delete / submit-for-review, each
 *     carrying a submission status: not submitted, pending, rejected, public).
 *   - Discover — the adoptable catalog (built-ins + other orgs' approved-public
 *     rows), rendered as cards by ScoringDiscoverTab; Adopt clones into the org.
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
  const [tab, setTab] = useState<RulesetsTab>('manage');

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Deep-link `?tab=` without next/navigation's useSearchParams (which makes the
  // React Compiler bail); read once on mount, mirror on change via window APIs.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time deep-link read on mount
    if (isTabKey(q)) setTab(q);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [tab]);

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

  // Manage shows only the org's own rulesets; built-ins and other orgs' shared
  // rows live in the Discover catalog tab.
  const manageRows = rows.filter((row) => row.owner_organization_id === orgId);

  return (
    <main id="main-content" className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('admin.rulesets.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('admin.rulesets.description')}</p>
      </div>

      <RulesetsTopNav active="scoring" basePath={`/org/${slugForLink}/rulesets`} />

      <SegmentedTabs
        tabs={[
          { value: 'manage' as const, label: t('admin.rulesets.discover.tabManage') },
          { value: 'discover' as const, label: t('admin.rulesets.discover.tabDiscover') },
        ]}
        value={tab}
        onChange={setTab}
        aria-label={t('admin.rulesets.title')}
        className="mb-6 max-w-md"
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {tab === 'discover' && orgId && (
        <RulesetDiscoverTab
          endpoint={`/api/v1/organizations/${orgId}/custom-rulesets/catalog`}
          toCards={(rows) => toScoringDiscoverCards(rows, t, slugForLink)}
        />
      )}

      {tab === 'manage' && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('admin.rulesets.curatedTitle')}
            </h2>
            <div className="flex items-center gap-2">
              {orgId && (
                <RulesetImportButton
                  endpoint={`/api/v1/organizations/${orgId}/custom-rulesets/import`}
                  onImported={refresh}
                />
              )}
              <Link
                href={`/org/${slugForLink}/rulesets/scoring/new`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
              >
                {t('admin.rulesets.createButton')}
              </Link>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
          ) : manageRows.length === 0 ? (
            <p className="text-sm text-muted">{t('admin.rulesets.discover.manageEmpty')}</p>
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableCell as="th">{t('admin.rulesets.shared.columns.name')}</DataTableCell>
                <DataTableCell as="th">{t('admin.rulesets.shared.columns.code')}</DataTableCell>
                <DataTableCell as="th">{t('admin.rulesets.shared.columns.version')}</DataTableCell>
                <DataTableCell as="th">{t('admin.rulesets.shared.columns.source')}</DataTableCell>
                <DataTableCell as="th">{t('admin.rulesets.colSubmission')}</DataTableCell>
                <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
              </DataTableHead>
              <tbody>
                {manageRows.map((row) => {
                  const isMine = row.owner_organization_id === orgId;
                  const source = rulesetSourceBadge(row, orgId, t);
                  const submissionBadge = rulesetSubmissionBadge(row, orgId, t);
                  const canSubmit =
                    isMine && !row.public_visibility && !row.submitted_for_review_at;
                  const actions = rulesetRowActions({ builtIn: row.is_system, mine: isMine });
                  return (
                    <DataTableRow key={row.id}>
                      <DataTableCell>
                        <div className="font-semibold text-foreground">{row.name}</div>
                        {row.base_code && (
                          <div className="mt-0.5 text-xs text-info">
                            {t('admin.rulesets.forkedFrom', {
                              base: row.lineage?.base ?? row.base_code,
                            })}
                          </div>
                        )}
                        {row.description && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                            {row.description}
                          </div>
                        )}
                        {/* The org's own forks live here, not in Discover — so
                            this is the table where lineage lamps actually earn
                            their keep. */}
                        {row.lineage && (
                          <div className="mt-2 max-w-xs">
                            <LineageLamps base={row.lineage.base} diff={row.lineage.diff} />
                          </div>
                        )}
                        {row.rejected_reason && (
                          <div className="mt-1 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
                            {t('admin.rulesets.rejectedReasonLabel')}: {row.rejected_reason}
                          </div>
                        )}
                      </DataTableCell>
                      <DataTableCell mono>{row.code}</DataTableCell>
                      <DataTableCell mono className="font-bold">
                        {row.version}
                      </DataTableCell>
                      <DataTableCell>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${source.className}`}
                        >
                          {source.label}
                        </span>
                      </DataTableCell>
                      <DataTableCell>
                        {submissionBadge ? (
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${submissionBadge.className}`}
                          >
                            {submissionBadge.label}
                          </span>
                        ) : (
                          <span className="text-xs italic text-muted">—</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        <ScoringManageActions
                          row={row}
                          actions={actions}
                          isMine={isMine}
                          canSubmit={canSubmit}
                          orgId={orgId}
                          slugForLink={slugForLink}
                          onSubmit={setSubmitTarget}
                          onDelete={setDeleteTarget}
                        />
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </>
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
