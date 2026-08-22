'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm, usePrompt } from '@myclash/ui';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import type {
  DoublePenaltySpec,
  FormulaConstants,
  FormulaNode,
  RankingRule,
  RulesetMetadata,
  Target,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import {
  RulesetForm,
  type MatchFormatDefaults,
  type RulesetFormValue,
} from '../../../../../../src/components/rulesets/RulesetForm';
import {
  isCodedRuleset,
  rulesetFormInitial,
  type RulesetRowLike,
} from '../../../../../../src/components/rulesets/ruleset-form-initial';
import { codedRulesetTfConfig } from '../../../../../../src/components/rulesets/coded-ruleset-body';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

type TfConfigOverride = NonNullable<RulesetRowLike['tf_config']>;

const apiUrl = getPublicApiUrl();

interface CustomRulesetDetail {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  tiebreakers: Tiebreaker[];
  match_format_defaults: Partial<MatchFormatDefaults> | null;
  double_penalty_formula: DoublePenaltySpec | null;
  targets: Target[] | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
  tf_config: TfConfigOverride | null;
  /** Set on a coded fork: the built-in coded engine it reuses. */
  base_code: string | null;
  is_default: boolean;
  is_system: boolean;
  systemRankingChain?: RankingRule[];
  systemMetadata?: RulesetMetadata;
}

interface VersionSnapshot {
  id: string;
  version: string;
  name: string;
  published_at: string;
  published_by_user_id: string | null;
  is_frozen: boolean;
}

export default function EditRulesetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<
    | (RulesetFormValue & {
        code: string;
        baseCode: string | null;
        isSystem: boolean;
        systemRankingChain?: RankingRule[];
        systemMetadata?: RulesetMetadata;
      })
    | null
  >(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!id) return;
    const r = await apiRequest<VersionSnapshot[]>(
      apiUrl,
      `/api/v1/admin/custom-rulesets/${id}/versions`,
    );
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.rulesets.versionHistoryLoadError'));
      if (message) setVersionsError(message);
      return;
    }
    setVersions(r.data);
    setVersionsError(null);
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void apiRequest<CustomRulesetDetail>(apiUrl, `/api/v1/admin/custom-rulesets/${id}`)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          const message = failureMessage(r, t, t('admin.rulesets.loadOneError'));
          if (message) setError(message);
          return;
        }
        const data = r.data;
        const formula =
          data.score_formula && 'type' in (data.score_formula as object)
            ? (data.score_formula as FormulaNode)
            : null;
        setInitial({
          code: data.code,
          name: data.name,
          description: data.description ?? '',
          version: data.version,
          scoreFormula: formula,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(data.constants ?? {}) },
          tiebreakers: data.tiebreakers ?? [],
          // TF v1 hydrates from tf_config.*, custom rulesets from the flat
          // columns — one shared helper so the org pages can't drift.
          ...rulesetFormInitial(data),
          baseCode: data.base_code,
          isSystem: data.is_system,
          systemRankingChain: data.systemRankingChain,
          systemMetadata: data.systemMetadata,
        });
        setCurrentVersion(data.version);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadVersions() fetches then sets state; intentional initial data load
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [id, t, loadVersions]);

  // The current draft is "frozen" when a tournament already references the
  // active (code, version) pair. The signal we have client-side is the
  // matching snapshot row in `versions` having is_frozen=true. We mirror the
  // server-side guard so the form disables and surfaces a banner without
  // waiting for the PATCH to round-trip.
  const isCurrentFrozen = Boolean(
    currentVersion && versions.find((v) => v.version === currentVersion && v.is_frozen),
  );

  async function handleRestore(snapshot: VersionSnapshot) {
    if (!id) return;
    const confirmed = await confirm({
      title: t('admin.rulesets.versionRestoreConfirm').replace('{version}', snapshot.version),
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const r = await apiRequest(
      apiUrl,
      `/api/v1/admin/custom-rulesets/${id}/versions/${snapshot.id}/rollback`,
      { method: 'POST' },
    );
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.rulesets.actionFailed'));
      if (message) setError(message);
      setBusy(false);
      return;
    }
    // Reload the form payload to reflect the restored draft.
    window.location.reload();
  }

  async function handlePublishNewVersion() {
    if (!id) return;
    const nextVersion = await prompt({
      title: t('admin.rulesets.publishNewVersionPrompt'),
      allowEmpty: true,
    });
    // Empty string = auto-bump; null (cancel) = abort.
    if (nextVersion === null) return;
    setBusy(true);
    setError(null);
    const r = await apiRequest(apiUrl, `/api/v1/admin/custom-rulesets/${id}/publish`, {
      method: 'POST',
      body: { nextVersion: nextVersion.trim() || undefined },
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.rulesets.actionFailed'));
      if (message) setError(message);
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <main className="grid max-w-6xl gap-6 p-8 lg:grid-cols-[1fr_280px]">
      <div>
        <BackLink href="/admin/rulesets" label={t('admin.rulesets.backToList')} className="mb-2" />
        <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('admin.rulesets.editTitle')}
        </h1>
        <p className="mb-6 text-sm text-muted">{t('admin.rulesets.editDescription')}</p>

        {error && (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading || !initial ? (
          <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
        ) : (
          <>
            {!initial.isSystem && isCurrentFrozen && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                <span>{t('admin.rulesets.versionFrozenBanner')}</span>
                <button
                  type="button"
                  onClick={() => void handlePublishNewVersion()}
                  disabled={busy}
                  className="rounded-md bg-warning px-3 py-1 text-xs font-semibold text-white hover:bg-warning-hover disabled:opacity-50"
                >
                  {t('admin.rulesets.publishNewVersionAction')}
                </button>
              </div>
            )}
            <RulesetForm
              initial={initial}
              validateUrl={`${apiUrl}/api/v1/admin/custom-rulesets/validate`}
              code={initial.code}
              baseCode={initial.baseCode}
              disabled={isCurrentFrozen}
              busy={busy}
              // Surface the coded system ruleset details (score formula +
              // tie-breakers + constants) in a read-only panel above the form.
              systemMetadata={initial.systemMetadata}
              systemRankingChain={initial.systemRankingChain}
              submitLabel={t('admin.rulesets.saveAction')}
              onSubmit={(data) => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  // A coded ruleset (TF v1 or a base_code fork of it) stores
                  // its tunables in `tf_config` — the back-end merges that over
                  // the coded defaults at tournament creation. A fork also
                  // writes the flat grammar targets so its lineage lamp +
                  // grammar resolver stay current. A formula ruleset sends the
                  // sibling columns as before.
                  const body = isCodedRuleset(initial.code, initial.baseCode)
                    ? {
                        name: data.name,
                        description: data.description,
                        version: data.version,
                        ...(initial.baseCode ? { targets: data.targets } : {}),
                        tfConfig: codedRulesetTfConfig(data),
                      }
                    : data;
                  const r = await apiRequest(apiUrl, `/api/v1/admin/custom-rulesets/${id}`, {
                    method: 'PATCH',
                    body,
                  });
                  if (!r.ok) {
                    const message = failureMessage(r, t, t('admin.rulesets.actionFailed'));
                    if (message) setError(message);
                    setBusy(false);
                    return;
                  }
                  router.push('/admin/rulesets/scoring');
                })();
              }}
              onCancel={() => router.push('/admin/rulesets/scoring')}
            />
          </>
        )}
      </div>

      {!loading && initial && !initial.isSystem && (
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-md border border-border bg-surface p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('admin.rulesets.versionHistoryTitle')}
            </h2>
            {versionsError && <p className="mb-2 text-xs text-danger">{versionsError}</p>}
            {versions.length === 0 ? (
              <p className="text-xs text-muted">{t('admin.rulesets.versionHistoryEmpty')}</p>
            ) : (
              <ul className="space-y-3">
                {versions.map((snap) => (
                  <li
                    key={snap.id}
                    className="border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {snap.version}
                      </span>
                      {snap.is_frozen && (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                          {t('admin.rulesets.versionFrozenBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(snap.published_at).toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleRestore(snap)}
                      disabled={busy || snap.version === currentVersion}
                      className="mt-1 text-xs font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                    >
                      {t('admin.rulesets.versionRestoreAction')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}

      {confirmDialog}
      {promptDialog}
    </main>
  );
}
